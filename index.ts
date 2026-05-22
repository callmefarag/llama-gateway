// ============================================================================
// LLAMA-GATEWAY — Main Orchestrator
// ============================================================================
import { loadConfig, parseListenPort } from "./src/config";
import { resolveOrSetupExecutable } from "./src/resolver";
import { generateLlamaSwapConfig } from "./src/generator/llama-swap";
import { generateOpenCodeConfig } from "./src/generator/opencode";
import { sanitizeMessages } from "./src/middleware/sanitizer";
import { deflateContext } from "./src/middleware/context";
import { resolveModel } from "./src/middleware/router";
import { buildMemoryInjection } from "./src/middleware/memory";
import { proxyRequest } from "./src/proxy";
import type { ChatMessage, ChatPayload } from "./src/types";

// ── Boot ──────────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
console.log(`  llama-gateway  ·  Bun v${Bun.version}`);
console.log(`${"═".repeat(60)}\n`);

// ── Load config ───────────────────────────────────────────────────────────────
const cfg = await loadConfig();
const modelList = cfg.models.map((m) => `${m.id} (${m.label})`).join(", ");
console.log(`[CONFIG] Gateway port : ${cfg.gateway.port}`);
console.log(`[CONFIG] llama-swap   : ${cfg.llama_swap.listen}`);
console.log(`[CONFIG] Models       : ${modelList || "⚠ none defined"}`);
console.log(`[CONFIG] Default model: ${cfg.routing.default_model}\n`);

// ── Resolve executables (PATH-first, then config path) ────────────────────────
const swapExe = await resolveOrSetupExecutable({
  name: "llama-swap",
  configuredValue: cfg.llama_swap.executable,
  configSection: "llama_swap",
});
const serverExe = await resolveOrSetupExecutable({
  name: "llama-server",
  configuredValue: cfg.llama_server.executable,
  configSection: "llama_server",
});
console.log(`[EXEC] llama-swap   : ${swapExe}`);
console.log(`[EXEC] llama-server : ${serverExe}\n`);

// ── Generate configs ──────────────────────────────────────────────────────────
await generateLlamaSwapConfig(cfg, serverExe);
await generateOpenCodeConfig(cfg);

// ── Spawn llama-swap ──────────────────────────────────────────────────────────
const swapArgs = [
  "--config", cfg.llama_swap.generated_config_path,
  "-listen", cfg.llama_swap.listen
];
if (cfg.llama_swap.watch_config !== false) swapArgs.push("-watch-config");

console.log(`[PROCESS] Spawning: ${swapExe} ${swapArgs.join(" ")}`);

const swapProcess = Bun.spawn([swapExe, ...swapArgs], {
  stdout: "inherit",
  stderr: "inherit",
  onExit(_, exitCode, signalCode) {
    console.error(
      `\n[CRITICAL] llama-swap exited (code: ${exitCode}, signal: ${signalCode ?? "none"}).`
    );
    process.exit(1);
  },
});

// ── Readiness probe ───────────────────────────────────────────────────────────
const swapPort = parseListenPort(cfg.llama_swap.listen);
const swapBaseUrl = `http://127.0.0.1:${swapPort}`;
const maxWaitMs = (cfg.llama_swap.health_check_timeout ?? 120) * 1000;
const bootStart = Date.now();

console.log(`\n[SYSTEM] Waiting for llama-swap on ${swapBaseUrl}…`);

let swapReady = false;
while (Date.now() - bootStart < maxWaitMs) {
  try {
    const res = await fetch(`${swapBaseUrl}/health`, { signal: AbortSignal.timeout(2000) });
    // 200 = ready with model loaded; 503 = up but no model loaded yet — both mean swap is alive
    if (res.status === 200 || res.status === 503 || res.status === 404) {
      swapReady = true;
      break;
    }
  } catch {
    // Not ready yet
  }
  await Bun.sleep(1000);
}

if (!swapReady) {
  console.error(
    `[CRITICAL] llama-swap did not become ready within ${cfg.llama_swap.health_check_timeout}s.`
  );
  swapProcess.kill();
  process.exit(1);
}

console.log(`[SYSTEM] llama-swap is ready ✓\n`);

// ── Gateway server ────────────────────────────────────────────────────────────
const { routing, context: ctxCfg, memory: memCfg } = cfg;

Bun.serve({
  port: cfg.gateway.port,

  async fetch(req: Request): Promise<Response> {
    // ── CORS preflight ──────────────────────────────────────────────────
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "*",
        },
      });
    }

    const url = new URL(req.url);
    const targetUrl = `${swapBaseUrl}${url.pathname}${url.search}`;
    const contentType = req.headers.get("content-type") ?? "";

    // ── Fast-path: non-JSON streams straight through ────────────────────
    if (!contentType.includes("application/json")) {
      return proxyRequest(req, targetUrl);
    }

    try {
      const payload = (await req.json()) as ChatPayload;
      const messages = (payload.messages ?? []) as ChatMessage[];

      // ── A. Sanitize vision assets ───────────────────────────────────
      const { hasImages, combinedTextContent } = sanitizeMessages(messages);
      const userPromptLower = combinedTextContent.toLowerCase();

      // ── B. Extract system prompt for routing ────────────────────────
      const sysMsg = messages.find((m) => m.role === "system");
      const systemPromptLower =
        typeof sysMsg?.content === "string"
          ? sysMsg.content.toLowerCase()
          : "";

      // ── C. Context runway deflation ─────────────────────────────────
      if (ctxCfg && messages.length > 0) {
        deflateContext(messages, ctxCfg.max_chars, ctxCfg.target_trim_chars);
      }

      // ── D. Intent routing ───────────────────────────────────────────
      const { model, ruleName } = resolveModel(routing.rules, routing.default_model, {
        hasImages,
        systemPrompt: systemPromptLower,
        userPrompt: userPromptLower,
      });
      console.log(`[ROUTER] "${ruleName}" → ${model}`);
      payload.model = model;

      // ── E. RAG memory injection ─────────────────────────────────────
      if (memCfg?.path) {
        const injection = await buildMemoryInjection(
          memCfg.path,
          userPromptLower,
          memCfg.always_inject_count
        );
        if (injection) {
          const sys = messages.find((m) => m.role === "system") as ChatMessage | undefined;
          if (sys && typeof sys.content === "string") {
            sys.content += injection;
          } else {
            messages.unshift({ role: "system", content: injection });
          }
        }
      }

      return proxyRequest(req, targetUrl, JSON.stringify(payload));
    } catch (err) {
      console.error("[GATEWAY] Error processing request:", err);
      // Fallback: stream original request body untouched
      return proxyRequest(req, targetUrl);
    }
  },
});

// ── Shutdown hooks ────────────────────────────────────────────────────────────
const shutdown = (signal: string) => {
  console.log(`\n[SYSTEM] ${signal} received — shutting down…`);
  swapProcess.kill();
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ── Ready banner ──────────────────────────────────────────────────────────────
console.log(`${"═".repeat(60)}`);
console.log(`  GATEWAY  ·  http://127.0.0.1:${cfg.gateway.port}/v1`);
console.log(`  SWAP     ·  ${swapBaseUrl}`);
if (cfg.opencode) {
  console.log(`  OPENCODE ·  ${cfg.opencode.generated_config_path}`);
}
console.log(`${"═".repeat(60)}\n`);
