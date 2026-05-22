// ============================================================================
// LLAMA-SWAP CONFIG GENERATOR
// Builds the llama-swap.yaml from the gateway model definitions.
// The output format matches the real llama-swap config schema exactly.
// ============================================================================

import { mkdir } from "fs/promises";
import { dirname } from "path";
import type { GatewayConfig, ModelDefinition, ModelFlags } from "../types";

// ── Quoting helper ────────────────────────────────────────────────────────────
/** Wrap a value in double-quotes if it contains spaces or special chars. */
function q(value: string): string {
  if (/[\s"'&|<>(){}[\];,]/.test(value)) {
    return `"${value}"`;
  }
  return value;
}

// ── Flag → CLI argument builder ───────────────────────────────────────────────
/**
 * Maps each ModelFlags key to its llama-server CLI flag(s).
 * Order here controls the order in the generated cmd string.
 */
function buildFlagArgs(flags: ModelFlags): string[] {
  const f = flags;
  const parts: string[] = [];

  // ── Vision ────────────────────────────────────────────────────────────
  if (f.mmproj) parts.push("--mmproj", q(f.mmproj));
  if (f.image_min_tokens !== undefined)
    parts.push("--image-min-tokens", String(f.image_min_tokens));
  if (f.image_max_tokens !== undefined)
    parts.push("--image-max-tokens", String(f.image_max_tokens));

  // ── GPU ───────────────────────────────────────────────────────────────
  if (f.ngl !== undefined) parts.push("-ngl", String(f.ngl));

  // ── Context ───────────────────────────────────────────────────────────
  if (f.ctx_size !== undefined) parts.push("--ctx-size", String(f.ctx_size));
  if (f.batch_size !== undefined)
    parts.push("--batch-size", String(f.batch_size));
  if (f.ubatch_size !== undefined)
    parts.push("-ub", String(f.ubatch_size));
  if (f.parallel !== undefined) parts.push("--parallel", String(f.parallel));

  // ── Threads ───────────────────────────────────────────────────────────
  if (f.threads !== undefined) parts.push("-t", String(f.threads));
  if (f.threads_batch !== undefined)
    parts.push("--threads-batch", String(f.threads_batch));

  // ── Sampling ──────────────────────────────────────────────────────────
  if (f.temp !== undefined) parts.push("--temp", String(f.temp));
  if (f.top_p !== undefined) parts.push("--top-p", String(f.top_p));
  if (f.top_k !== undefined) parts.push("--top-k", String(f.top_k));
  if (f.min_p !== undefined) parts.push("--min-p", String(f.min_p));
  if (f.repeat_penalty !== undefined)
    parts.push("--repeat-penalty", String(f.repeat_penalty));
  if (f.repeat_last_n !== undefined)
    parts.push("--repeat-last-n", String(f.repeat_last_n));
  if (f.seed !== undefined) parts.push("--seed", String(f.seed));

  // ── Attention ─────────────────────────────────────────────────────────
  if (f.flash_attn) parts.push("--flash-attn", "on");

  // ── Memory ────────────────────────────────────────────────────────────
  if (f.no_mmap) parts.push("--no-mmap");
  if (f.mlock) parts.push("--mlock");

  // ── KV Cache ──────────────────────────────────────────────────────────
  if (f.cache_type_k) parts.push("--cache-type-k", f.cache_type_k);
  if (f.cache_type_v) parts.push("--cache-type-v", f.cache_type_v);
  if (f.cache_prompt) parts.push("--cache-prompt");
  if (f.cache_idle_slots) parts.push("--cache-idle-slots");
  if (f.kv_unified) parts.push("--kv-unified");
  if (f.slot_save_path) parts.push("--slot-save-path", q(f.slot_save_path));
  if (f.ctx_checkpoints !== undefined)
    parts.push("--ctx-checkpoints", String(f.ctx_checkpoints));

  // ── Context behavior ──────────────────────────────────────────────────
  if (f.context_shift) parts.push("--context-shift");

  // ── Priority ──────────────────────────────────────────────────────────
  if (f.prio !== undefined) parts.push("--prio", String(f.prio));

  // ── Templates ─────────────────────────────────────────────────────────
  if (f.jinja) parts.push("--jinja");
  if (f.chat_template_file)
    parts.push("--chat-template-file", q(f.chat_template_file));
  if (f.chat_template_kwargs) {
    // The JSON string needs inner quotes escaped for the shell
    const escaped = f.chat_template_kwargs.replace(/"/g, '\\"');
    parts.push("--chat-template-kwargs", `"${escaped}"`);
  }

  // ── Misc ──────────────────────────────────────────────────────────────
  if (f.reasoning !== undefined) parts.push("--reasoning", String(f.reasoning));
  if (f.no_warmup) parts.push("--no-warmup");

  return parts;
}

// ── Full cmd string builder ───────────────────────────────────────────────────
function buildCmd(model: ModelDefinition, serverExe: string): string {
  const parts: string[] = [];

  // Binary (quoted if path has spaces)
  parts.push(q(serverExe));

  // Model path (always first flag)
  parts.push("--model", q(model.model_path));

  // Host + port — always injected by generator; user never sets this
  parts.push("--host", "127.0.0.1", "--port", "${PORT}");

  // Structured flags
  if (model.flags) {
    parts.push(...buildFlagArgs(model.flags));
  }

  // Raw extra flags — appended verbatim (escape hatch for exotic/new flags)
  if (model.extra_flags?.trim()) {
    parts.push(model.extra_flags.trim());
  }

  return parts.join(" ");
}

// ── YAML line helpers ─────────────────────────────────────────────────────────
/** Wrap a string in YAML double-quotes, escaping internal double-quotes. */
function yamlStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// ── Main generator ────────────────────────────────────────────────────────────
export async function generateLlamaSwapConfig(
  cfg: GatewayConfig,
  resolvedServerExe: string
): Promise<void> {
  const outPath = cfg.llama_swap.generated_config_path;

  // Ensure output directory exists
  await mkdir(dirname(outPath), { recursive: true });

  const lines: string[] = [
    "# AUTO-GENERATED by llama-gateway — DO NOT EDIT MANUALLY",
    "# Edit gateway.config.yaml and restart the gateway (or it auto-regenerates).",
    `# Generated: ${new Date().toISOString()}`,
    "",
    `healthCheckTimeout: ${cfg.llama_swap.health_check_timeout ?? 120}`,
    `logLevel: ${yamlStr(cfg.llama_swap.log_level ?? "info")}`,
  ];

  if (cfg.llama_swap.global_ttl !== undefined) {
    lines.push(`globalTTL: ${cfg.llama_swap.global_ttl}`);
  }
  if (cfg.llama_swap.send_loading_state) {
    lines.push("sendLoadingState: true");
  }

  if (cfg.models.length === 0) {
    console.warn(
      "[GENERATOR] ⚠ No models defined in gateway.config.yaml — llama-swap will start with no models."
    );
    lines.push("", "models: {}");
  } else {
    lines.push("", "models:");

    for (const model of cfg.models) {
      const cmd = buildCmd(model, resolvedServerExe);

      lines.push(`  ${model.id}:`);
      // Use block scalar >- so the cmd is readable and not escaped
      lines.push(`    cmd: >-`);
      lines.push(`      ${cmd}`);
      lines.push(`    proxy: "http://127.0.0.1:\${PORT}"`);

      if (model.ttl !== undefined) {
        lines.push(`    ttl: ${model.ttl}`);
      }

      if (model.aliases && model.aliases.length > 0) {
        lines.push(`    aliases:`);
        for (const alias of model.aliases) {
          lines.push(`      - ${yamlStr(alias)}`);
        }
      }

      lines.push(""); // blank line between models
    }
  }

  await Bun.write(outPath, lines.join("\n"));
  console.log(`[GENERATOR] llama-swap config → ${outPath}`);
}
