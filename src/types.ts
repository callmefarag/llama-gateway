// ============================================================================
// SHARED TYPES
// All interfaces live here. No `any` in the rest of the codebase.
// ============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

// ── llama-server flag definitions ─────────────────────────────────────────────
/**
 * All curated llama-server flags as typed config keys.
 * Flags not listed here can be added via `extra_flags` (appended verbatim).
 */
export interface ModelFlags {
  // ── Vision ──────────────────────────────────────────────────────────────
  mmproj?: string; // --mmproj <path>  (multimodal projector)
  image_min_tokens?: number; // --image-min-tokens <N>
  image_max_tokens?: number; // --image-max-tokens <N>

  // ── GPU ─────────────────────────────────────────────────────────────────
  ngl?: number; // -ngl <N>          (GPU layers to offload)

  // ── Context ─────────────────────────────────────────────────────────────
  ctx_size?: number; // --ctx-size <N>
  batch_size?: number; // --batch-size <N>
  ubatch_size?: number; // -ub <N>
  parallel?: number; // --parallel <N>
  context_shift?: boolean; // --context-shift
  ctx_checkpoints?: number; // --ctx-checkpoints <N>

  // ── Threads ─────────────────────────────────────────────────────────────
  threads?: number; // -t <N>
  threads_batch?: number; // --threads-batch <N>

  // ── Sampling ────────────────────────────────────────────────────────────
  temp?: number; // --temp <F>
  top_p?: number; // --top-p <F>
  top_k?: number; // --top-k <N>
  min_p?: number; // --min-p <F>
  repeat_penalty?: number; // --repeat-penalty <F>
  repeat_last_n?: number; // --repeat-last-n <N>
  seed?: number; // --seed <N>

  // ── Attention & Memory ──────────────────────────────────────────────────
  flash_attn?: boolean; // --flash-attn on
  no_mmap?: boolean; // --no-mmap
  mlock?: boolean; // --mlock

  // ── KV Cache ────────────────────────────────────────────────────────────
  cache_type_k?: string; // --cache-type-k <val>   (q8_0, q4_0, f16…)
  cache_type_v?: string; // --cache-type-v <val>
  cache_prompt?: boolean; // --cache-prompt
  cache_idle_slots?: boolean; // --cache-idle-slots
  kv_unified?: boolean; // --kv-unified
  slot_save_path?: string; // --slot-save-path <path>

  // ── Templates & Chat ────────────────────────────────────────────────────
  jinja?: boolean; // --jinja
  chat_template_file?: string; // --chat-template-file <path>
  /** Raw JSON string, e.g. '{"enable_thinking":true}' */
  chat_template_kwargs?: string; // --chat-template-kwargs "<json>"

  // ── Misc ────────────────────────────────────────────────────────────────
  prio?: number; // --prio <N>         (process priority)
  reasoning?: string; // --reasoning <on|off>
  no_warmup?: boolean; // --no-warmup
}

// ── Model definition ─────────────────────────────────────────────────────────
export interface ModelDefinition {
  id: string;
  label: string;
  model_path: string;
  ttl?: number; // llama-swap TTL in seconds (0 = never unload)
  aliases?: string[]; // llama-swap model aliases
  flags?: ModelFlags;
  /** Any llama-server flags not in `flags`. Appended verbatim to the cmd. */
  extra_flags?: string;
}

// ── Routing ──────────────────────────────────────────────────────────────────
export type RoutingCondition =
  | "has_images"
  | "system_contains"
  | "user_contains"
  | "prompt_contains";

export interface RoutingRule {
  name: string;
  condition: RoutingCondition;
  keywords?: string[];
  model: string;
}

// ── Top-level gateway config (maps to gateway.config.yaml) ───────────────────
export interface GatewayConfig {
  gateway: {
    port: number;
    log_level?: LogLevel;
  };

  memory?: {
    path: string;
    always_inject_count?: number;
  };

  llama_swap: {
    /** Combined listen address, e.g. "127.0.0.1:8081" */
    listen: string;
    /** Name on PATH or absolute path. Bun.which() is tried first. */
    executable: string;
    watch_config?: boolean;
    generated_config_path: string;
    health_check_timeout?: number;
    global_ttl?: number;
    log_level?: LogLevel;
    send_loading_state?: boolean;
  };

  llama_server: {
    /** Name on PATH or absolute path. Bun.which() is tried first. */
    executable: string;
  };

  models: ModelDefinition[];

  routing: {
    default_model: string;
    rules: RoutingRule[];
  };

  context?: {
    max_chars: number;
    target_trim_chars: number;
  };

  opencode?: {
    generated_config_path: string;
    provider_id: string;
    provider_name: string;
    /** Model to use for lightweight tasks (title gen, summaries) */
    small_model?: string;
  };
}

// ── Runtime / Middleware types ────────────────────────────────────────────────
export interface ContentPart {
  type: "text" | "image_url" | string;
  text?: string;
  image_url?: { url: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
}

export interface ChatPayload {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  [key: string]: unknown;
}

export interface RouterContext {
  hasImages: boolean;
  systemPrompt: string;
  userPrompt: string;
}
