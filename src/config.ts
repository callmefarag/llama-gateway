// ============================================================================
// CONFIG LOADER
// Reads gateway.config.yaml, validates it, expands paths, and resolves
// executables using PATH (cross-platform: PowerShell/Windows + bash/zsh/Linux).
// ============================================================================

import { load as yamlLoad } from "js-yaml";
import { homedir, platform } from "os";
import { dirname, isAbsolute, resolve } from "path";
import type { GatewayConfig } from "./types";

export const CONFIG_FILE =
  process.env.GATEWAY_CONFIG ?? "./gateway.config.yaml";

// ── Path helpers ──────────────────────────────────────────────────────────────

function expandHome(p: string): string {
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) {
    return p.replace(/^~/, homedir());
  }
  return p;
}

function resolvePath(p: string): string {
  const expanded = expandHome(p);
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

// ── Validation helpers ────────────────────────────────────────────────────────

function assertField(obj: unknown, dotPath: string): void {
  const parts = dotPath.split(".");
  let cur: unknown = obj;
  for (const key of parts) {
    if (cur == null || typeof cur !== "object" || !(key in (cur as object))) {
      throw new Error(
        `[CONFIG] Missing required field: "${dotPath}"\n` +
          `  Check your gateway.config.yaml — see gateway.config.example.yaml for reference.`
      );
    }
    cur = (cur as Record<string, unknown>)[key];
  }
}

// ── Config loader ─────────────────────────────────────────────────────────────

export async function loadConfig(): Promise<GatewayConfig> {
  const configPath = resolvePath(CONFIG_FILE);
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    const defaultConfig = `# =============================================================================
# gateway.config.yaml  —  Local configuration file for llama-gateway
# Edit this file with your model paths and executable locations.
# =============================================================================

gateway:
  port: 8082          # The port your IDE client (OpenCode, Roo, Cline) connects to
  log_level: info     # debug | info | warn | error

llama_swap:
  listen: "127.0.0.1:8081"   # address llama-swap listens on
  executable: llama-swap      # Name on PATH or full path to the llama-swap binary
  watch_config: true          # hot-reload when generated config changes
  generated_config_path: ./generated/llama-swap.yaml
  health_check_timeout: 120   # seconds to wait for model to load
  global_ttl: 0               # 0 = models never auto-unload
  log_level: info
  send_loading_state: true

llama_server:
  executable: llama-server    # Name on PATH or full path to llama-server

models:
  - id: my-fast-model
    label: "Gemma 4B (Vision)"
    model_path: C:/Tools/llama-cpp/models/gemma-4b.gguf # change this to your GGUF file path
    ttl: 180
    aliases:
      - "vision"
      - "fast"
    flags:
      ngl: 99
      ctx_size: 8192
      flash_attn: true
      cache_type_k: q8_0
      cache_type_v: q8_0

  - id: my-big-model
    label: "Qwen 35B MoE (Coder)"
    model_path: C:/Tools/llama-cpp/models/qwen-35b.gguf # change this to your GGUF file path
    ttl: 0
    aliases:
      - "coder"
      - "default"
    flags:
      ngl: 99
      ctx_size: 32768
      flash_attn: true
      cache_type_k: q8_0
      cache_type_v: q8_0
    extra_flags: ""

routing:
  default_model: my-big-model
  rules:
    - name: "Vision"
      condition: has_images
      model: my-fast-model

context:
  max_chars: 95000
  target_trim_chars: 65000

opencode:
  generated_config_path: ./generated/opencode.jsonc
  provider_id: llama-gateway
  provider_name: "Llama Gateway (Local)"
  small_model: my-fast-model
`;

    await Bun.write(configPath, defaultConfig);
    console.log(`\n[CONFIG] Created a default configuration file at:\n  ✓ ${configPath}`);
    console.log(`\nPlease edit this file with your model paths and run llama-gateway again!\n`);
    process.exit(0);
  }

  const raw = await file.text();
  const cfg = yamlLoad(raw) as GatewayConfig;

  // ── Required field validation ──────────────────────────────────────────
  assertField(cfg, "gateway.port");
  assertField(cfg, "llama_swap.listen");
  assertField(cfg, "llama_swap.executable");
  assertField(cfg, "llama_swap.generated_config_path");
  assertField(cfg, "llama_server.executable");
  assertField(cfg, "models");
  assertField(cfg, "routing.default_model");

  if (!Array.isArray(cfg.models)) {
    throw new Error('[CONFIG] "models" must be a YAML list (array).');
  }

  // ── Validate model IDs ─────────────────────────────────────────────────
  const modelIds = new Set(cfg.models.map((m) => m.id));
  if (!modelIds.has(cfg.routing.default_model)) {
    throw new Error(
      `[CONFIG] routing.default_model "${cfg.routing.default_model}" does not match any model id.\n` +
        `  Available ids: ${[...modelIds].join(", ")}`
    );
  }
  for (const rule of cfg.routing?.rules ?? []) {
    if (!modelIds.has(rule.model)) {
      console.warn(
        `[CONFIG] ⚠ Routing rule "${rule.name}" references unknown model id "${rule.model}"`
      );
    }
  }

  // ── Apply defaults ─────────────────────────────────────────────────────
  cfg.gateway.log_level ??= "info";
  cfg.llama_swap.watch_config ??= true;
  cfg.llama_swap.health_check_timeout ??= 120;
  cfg.llama_swap.log_level ??= "info";
  cfg.routing.rules ??= [];
  cfg.context ??= { max_chars: 95000, target_trim_chars: 65000 };

  // ── Expand paths ───────────────────────────────────────────────────────
  if (cfg.memory?.path) {
    cfg.memory.path = expandHome(cfg.memory.path);
  }
  cfg.llama_swap.generated_config_path = resolvePath(
    cfg.llama_swap.generated_config_path
  );
  if (cfg.opencode?.generated_config_path) {
    cfg.opencode.generated_config_path = resolvePath(
      cfg.opencode.generated_config_path
    );
  }

  return cfg;
}

// ── Executable resolver ───────────────────────────────────────────────────────
/**
 * Resolves an executable name or path.
 *
 * Strategy (cross-platform):
 *   1. If the value looks like a path (contains / or \), check file existence.
 *   2. Otherwise, use Bun.which() which searches PATH correctly on all platforms:
 *      - Windows (PowerShell / cmd): adds .exe / .cmd / .bat automatically
 *      - Linux / macOS (bash / zsh): standard PATH search
 */
export async function resolveExecutable(nameOrPath: string): Promise<string> {
  const isPath = nameOrPath.includes("/") || nameOrPath.includes("\\");

  if (isPath) {
    const file = Bun.file(nameOrPath);
    if (await file.exists()) return nameOrPath;
    throw new Error(
      `[CONFIG] Executable not found at path: "${nameOrPath}"\n` +
        `  Verify the path exists and is correct in gateway.config.yaml.\n` +
        (platform() === "win32"
          ? `  Windows tip: use forward slashes or double backslashes:\n` +
            `    C:/Tools/llama-swap/llama-swap.exe\n` +
            `    C:\\\\Tools\\\\llama-swap\\\\llama-swap.exe`
          : `  Linux/macOS tip: make sure the binary has execute permission (chmod +x).`)
    );
  }

  // Try Bun.which() — handles PATH on Windows (PowerShell/cmd) and Unix shells
  const found = Bun.which(nameOrPath);
  if (found) return found;

  const isWindows = platform() === "win32";
  throw new Error(
    `[CONFIG] Cannot find "${nameOrPath}" on PATH.\n\n` +
      `  Option A: Add it to your ${isWindows ? "system PATH" : "PATH"} and restart.\n` +
      `  Option B: Set the full absolute path in gateway.config.yaml:\n\n` +
      (isWindows
        ? `    llama_swap:\n      executable: C:/Tools/llama-swap/llama-swap.exe\n\n` +
          `    llama_server:\n      executable: C:/Tools/llama-cpp/llama-server.exe`
        : `    llama_swap:\n      executable: /usr/local/bin/llama-swap\n\n` +
          `    llama_server:\n      executable: /usr/local/bin/llama-server`)
  );
}

/** Extract the port number from a listen address like "127.0.0.1:8081" */
export function parseListenPort(listen: string): number {
  const lastColon = listen.lastIndexOf(":");
  if (lastColon === -1)
    throw new Error(`[CONFIG] Invalid listen address: "${listen}"`);
  const port = parseInt(listen.slice(lastColon + 1), 10);
  if (isNaN(port))
    throw new Error(`[CONFIG] Invalid port in listen address: "${listen}"`);
  return port;
}
