# 📖 llama-gateway — Full Usage Guide

> **← [Back to README](README.MD)**

---

## Table of Contents

- [Running the Gateway](#running-the-gateway)
- [Installing to PATH](#installing-to-path)
- [gateway.config.yaml — Complete Reference](#gatewayconfigyaml--complete-reference)
  - [Gateway Settings](#gateway-settings)
  - [Memory / RAG Settings](#memory--rag-settings)
  - [llama-swap Settings](#llama-swap-settings)
  - [llama-server Settings](#llama-server-settings)
  - [Model Definitions](#model-definitions)
  - [All Supported Flags](#all-supported-flags)
  - [Routing Rules](#routing-rules)
  - [Context Shield Settings](#context-shield-settings)
  - [OpenCode Settings](#opencode-settings)
- [Adding & Managing Models](#adding--managing-models)
- [Intent Routing — Deep Dive](#intent-routing--deep-dive)
- [Context Runway Shield — How It Works](#context-runway-shield--how-it-works)
- [Vision Sanitization — How It Works](#vision-sanitization--how-it-works)
- [RAG Project Memory](#rag-project-memory)
- [OpenCode Integration — Full Guide](#opencode-integration--full-guide)
- [Environment Variables](#environment-variables)
- [Hot-Reload Workflow](#hot-reload-workflow)
- [Troubleshooting](#troubleshooting)
- [Architecture Reference](#architecture-reference)

---

## Running the Gateway

### Standard start

```bash
bun start
```

### Watch mode (auto-restart on code changes)

```bash
bun run dev
```

### Test config + generators without starting processes

Useful to preview `generated/llama-swap.yaml` and `generated/opencode.jsonc` before your first real run:

```bash
bun run test-gen
```

### Use a custom config file path

```bash
GATEWAY_CONFIG=/path/to/my-config.yaml bun start
```

### Graceful shutdown

The gateway handles both `Ctrl+C` (`SIGINT`) and `SIGTERM` (Docker / systemd), killing the `llama-swap` subprocess cleanly on exit.

---

## Installing to PATH

### The recommended way: `bun run install-path`

```bash
bun run install-path
```

This compiles a **standalone binary** (no Bun runtime needed after this step) and installs it to the correct location for your platform:

| Platform | Install location |
|---|---|
| Windows | `%APPDATA%\Local\Programs\llama-gateway\llama-gateway.exe` |
| Linux | `~/.local/bin/llama-gateway` |
| macOS | `~/.local/bin/llama-gateway` |

The script prints exact instructions to add the directory to `PATH` if it isn't already there.

### Windows (PowerShell) — Add to PATH permanently

```powershell
[Environment]::SetEnvironmentVariable(
  "PATH",
  [Environment]::GetEnvironmentVariable("PATH","User") + ";$env:APPDATA\Local\Programs\llama-gateway",
  "User"
)
```

Restart your terminal, then: `llama-gateway`

### Linux / macOS — Add to PATH permanently

```bash
# Add to ~/.bashrc or ~/.zshrc
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Then run:
llama-gateway
```

### Workflow after PATH install

```bash
# Run from any directory — config is always read from ./gateway.config.yaml in CWD
cd /path/to/your/project
llama-gateway

# Or point to a specific config
GATEWAY_CONFIG=/etc/llama-gateway/server.yaml llama-gateway

# CLI flags
llama-gateway --help
llama-gateway --version
llama-gateway --install   # re-run the installer to update the binary
```

### Build the binary manually

```bash
bun run build
# Output: dist/llama-gateway  (or dist/llama-gateway.exe on Windows)
```

---

## gateway.config.yaml — Complete Reference

### Gateway Settings

```yaml
gateway:
  port: 8082         # The port your IDE client connects to (OpenAI-compatible API)
  log_level: info    # debug | info | warn | error
```

> **`port`** — OpenCode, Roo Code, Cline, and any OpenAI-compatible client connects here.
> Change this if port `8082` is in use.

---

### Memory / RAG Settings

```yaml
memory:
  path: ~/.llama-gateway/memory.jsonl   # ~ expands to your home directory
  always_inject_count: 3                # always inject top N entries
```

> `always_inject_count` — the gateway always injects this many entries from the top of the file,
> regardless of keyword matching. Additional entries are injected when their `category` or `context`
> appears in the user prompt.
>
> See [RAG Project Memory](#rag-project-memory) for the full memory format.

---

### llama-swap Settings

```yaml
llama_swap:
  listen: "127.0.0.1:8081"          # address llama-swap listens on
  executable: llama-swap             # name on PATH, or absolute path
  watch_config: true                 # enable hot-reload when generated config changes
  generated_config_path: ./generated/llama-swap.yaml
  health_check_timeout: 120          # seconds to wait for llama-swap to become ready
  global_ttl: 0                      # default TTL for all models (0 = never unload)
  log_level: info                    # llama-swap's own log level
  send_loading_state: true           # sends a loading status while a model warms up
```

**Executable resolution (cross-platform):**

The gateway uses `Bun.which()` first, which searches `PATH` correctly on all platforms:
- **Windows (PowerShell/cmd):** automatically checks `.exe`, `.cmd`, `.bat` extensions
- **Linux/macOS (bash/zsh):** standard PATH search

If not found on PATH, the gateway checks if the value is an absolute or relative file path.

```yaml
# Examples:
executable: llama-swap                           # on PATH (Linux/macOS)
executable: C:\Tools\llama-swap\llama-swap.exe  # absolute path (Windows)
executable: ./llama-swap.exe                    # relative to gateway dir
```

---

### llama-server Settings

```yaml
llama_server:
  executable: llama-server    # name on PATH, or absolute path
```

Same resolution rules as `llama_swap.executable`. This binary is what llama-swap runs for each model.

```yaml
# Examples:
executable: llama-server                              # on PATH (Linux/macOS)
executable: C:\Tools\llama-cpp\llama-server.exe       # Windows
executable: /usr/local/bin/llama-server               # absolute path
```

---

### Model Definitions

```yaml
models:
  - id: my-model             # unique ID, used in routing rules and OpenCode
    label: "My Model Name"   # human-readable name shown in OpenCode
    model_path: /path/to/model.gguf
    ttl: 300                 # seconds until llama-swap unloads idle model (0 = never)
    aliases:                 # additional names that route to this model in llama-swap
      - "my-alias"
      - "another-alias"
    flags:                   # curated llama-server flags (see full table below)
      ngl: 99
      ctx_size: 32768
      flash_attn: true
    extra_flags: ""          # raw string appended verbatim — full escape hatch
```

> **`id`** must be unique across all models. Used in routing rules (`model: my-model`) and in
> OpenCode model references (`llama-gateway/my-model`).

> **`aliases`** are passed to llama-swap as-is. OpenCode and other clients can use these names
> to directly target a model, bypassing the gateway's routing logic.

> **`ttl`** — if a model is idle for `ttl` seconds, llama-swap unloads it from VRAM.
> The next request will re-load it (cold start). Set to `0` to keep models loaded permanently.

---

### All Supported Flags

Every flag maps directly to a `llama-server` CLI argument. The gateway generates the correct
CLI string in `generated/llama-swap.yaml`.

#### Vision Flags
| Flag | CLI | Description |
|---|---|---|
| `mmproj` | `--mmproj <path>` | Path to the multimodal projector file (required for vision models) |
| `image_min_tokens` | `--image-min-tokens <N>` | Minimum number of vision tokens to allocate |
| `image_max_tokens` | `--image-max-tokens <N>` | Maximum number of vision tokens to allocate |

#### GPU Flags
| Flag | CLI | Description |
|---|---|---|
| `ngl` | `-ngl <N>` | Number of model layers to offload to GPU. Set to `99` to offload everything. Reduce if you run out of VRAM. |

#### Context Flags
| Flag | CLI | Description |
|---|---|---|
| `ctx_size` | `--ctx-size <N>` | Context window in tokens. Larger = more VRAM. Must not exceed model's trained limit. |
| `batch_size` | `--batch-size <N>` | Prompt evaluation batch size. Larger = faster prompt processing, more VRAM. |
| `ubatch_size` | `-ub <N>` | Micro-batch size for prompt processing. |
| `parallel` | `--parallel <N>` | Number of simultaneous request slots. Each slot uses its own KV cache slice. |
| `context_shift` | `--context-shift` | Enable context shifting to handle inputs longer than `ctx_size`. |
| `ctx_checkpoints` | `--ctx-checkpoints <N>` | Enable context checkpointing for very long contexts. |

#### Thread Flags
| Flag | CLI | Description |
|---|---|---|
| `threads` | `-t <N>` | CPU threads for prompt evaluation. |
| `threads_batch` | `--threads-batch <N>` | CPU threads for batch evaluation. |

#### Sampling Flags
| Flag | CLI | Description |
|---|---|---|
| `temp` | `--temp <F>` | Temperature. `0.0` = deterministic, `1.0` = creative. |
| `top_p` | `--top-p <F>` | Top-P (nucleus sampling). |
| `top_k` | `--top-k <N>` | Top-K sampling. |
| `min_p` | `--min-p <F>` | Minimum probability threshold. |
| `repeat_penalty` | `--repeat-penalty <F>` | Repetition penalty. `1.0` = disabled. |
| `repeat_last_n` | `--repeat-last-n <N>` | Tokens to look back for repetition penalty. |
| `seed` | `--seed <N>` | RNG seed. `-1` = random. |

#### Attention & Memory Flags
| Flag | CLI | Description |
|---|---|---|
| `flash_attn` | `--flash-attn on` | Enable FlashAttention. Almost always beneficial — reduces VRAM and speeds up inference. |
| `no_mmap` | `--no-mmap` | Disable memory-mapped file I/O. Useful on Windows to prevent file locking. |
| `mlock` | `--mlock` | Lock model weights in RAM. Prevents OS from swapping them out under memory pressure. |

#### KV Cache Flags
| Flag | CLI | Description |
|---|---|---|
| `cache_type_k` | `--cache-type-k <val>` | K-cache quantization: `f16` \| `q8_0` \| `q4_0` \| `q4_1` \| `iq4_nl`. `q8_0` is a good balance. |
| `cache_type_v` | `--cache-type-v <val>` | V-cache quantization. Same options. |
| `cache_prompt` | `--cache-prompt` | Enable KV cache reuse across requests with matching prefixes. Significant speedup for long system prompts. |
| `cache_idle_slots` | `--cache-idle-slots` | Keep KV cache of idle slots. Useful with `slot_save_path`. |
| `kv_unified` | `--kv-unified` | Use a unified KV cache allocation strategy. |
| `slot_save_path` | `--slot-save-path <path>` | Directory for saving/restoring KV cache slot state across server restarts. |

#### Template Flags
| Flag | CLI | Description |
|---|---|---|
| `jinja` | `--jinja` | Enable Jinja2 chat template engine. Required for models with custom templates. |
| `chat_template_file` | `--chat-template-file <path>` | Path to a `.jinja` template file. |
| `chat_template_kwargs` | `--chat-template-kwargs "<json>"` | JSON string of extra kwargs passed to the template. e.g. `'{"enable_thinking":true}'` |

#### Misc Flags
| Flag | CLI | Description |
|---|---|---|
| `prio` | `--prio <N>` | Process scheduling priority. `0`=normal, `1`=medium, `2`=high, `3`=realtime. |
| `reasoning` | `--reasoning <on\|off>` | Enable or disable chain-of-thought reasoning output. |
| `no_warmup` | `--no-warmup` | Skip the warm-up inference pass on model load. Faster cold start. |

#### Extra Flags (Escape Hatch)

Any `llama-server` flag not listed above — including new flags added in recent llama.cpp releases — can be added via `extra_flags`:

```yaml
extra_flags: '-ot ".ffn_(up|down)_exps.=CPU" --mlock --some-new-flag value'
```

The contents of `extra_flags` are appended **verbatim** to the end of the generated `cmd` string.

---

### Routing Rules

```yaml
routing:
  default_model: qwen      # model id to use when no rule matches
  rules:
    - name: "Vision"
      condition: has_images
      model: gemma-low

    - name: "Planner"
      condition: system_contains
      keywords: ["archivist", "plan"]
      model: gemma
```

**Rules are evaluated top-to-bottom. The first match wins.**

| Condition | Trigger |
|---|---|
| `has_images` | Payload contains at least one image attachment |
| `system_contains` | The system prompt contains any of the `keywords` (case-insensitive) |
| `user_contains` | Any user message contains any of the `keywords` (case-insensitive) |
| `prompt_contains` | Either system prompt or user messages contain any keyword |

> **Tip:** Order your rules from most-specific to least-specific. Vision detection should
> come first since an image payload with a planning question should go to the vision model,
> not the planner.

---

### Context Shield Settings

```yaml
context:
  max_chars: 95000          # character count that triggers deflation
  target_trim_chars: 65000  # target size after deflation
```

See [Context Runway Shield — How It Works](#context-runway-shield--how-it-works) for details.

---

### OpenCode Settings

```yaml
opencode:
  generated_config_path: ./generated/opencode.jsonc
  provider_id: llama-gateway        # appears as "llama-gateway/model-id" in OpenCode
  provider_name: "Llama Gateway (Local)"
  small_model: gemma-low            # used for: title generation, session summaries
```

---

## Adding & Managing Models

### Adding your first model

1. Find your GGUF model path
2. Open `gateway.config.yaml`
3. Add to the `models` list:

```yaml
models:
  - id: phi4
    label: "Phi-4 14B"
    model_path: D:\AI_Models\phi-4-14b-q8_0.gguf
    ttl: 180
    flags:
      ngl: 99
      ctx_size: 16384
      flash_attn: true
      cache_type_k: q8_0
      cache_type_v: q8_0
      cache_prompt: true
```

4. Add a routing rule (or set it as `default_model`)
5. Restart the gateway — it will appear in OpenCode automatically

### Adding a MoE model (Qwen / DeepSeek style)

MoE models have expert layers that often don't fit in VRAM. Use `extra_flags` to offload them to CPU:

```yaml
- id: qwen35b
  label: "Qwen3.6 35B MoE"
  model_path: /path/to/qwen35b.gguf
  flags:
    ngl: 99           # offload non-expert layers to GPU
    ctx_size: 32768
    flash_attn: true
    no_mmap: true
  extra_flags: '-ot ".ffn_(up|down)_exps.=CPU"'   # offload MoE experts to CPU
```

### Adding a vision model (multimodal)

Vision models require a separate multimodal projector (mmproj) file:

```yaml
- id: gemma-vision
  label: "Gemma 4B Vision"
  model_path: /path/to/gemma-4b.gguf
  flags:
    mmproj: /path/to/gemma-4b-mmproj-f16.gguf
    image_min_tokens: 560
    image_max_tokens: 2240
    ngl: 99
    ctx_size: 32768
    flash_attn: true
```

> **Always add a routing rule** for vision models with `condition: has_images` so the gateway
> automatically routes image payloads to this model.

### Removing a model

Delete the entry from `gateway.config.yaml`. On the next startup (or hot-reload), the model
is removed from the generated `llama-swap.yaml` and unloaded from VRAM.

---

## Intent Routing — Deep Dive

### How OpenCode sends agent context

When you're in OpenCode's "plan" mode, it injects a specific system prompt that identifies the
active agent. The gateway reads this system prompt and matches it against your routing rules.

For example, OpenCode's plan agent injects something like:
```
You are an expert software architect. Your role is to plan...
```

If your routing rule has `keywords: ["plan", "archivist"]` and `condition: system_contains`,
the gateway catches this and routes to your designated planner model.

### Rule evaluation example

Given these rules:
```yaml
routing:
  default_model: qwen
  rules:
    - name: "Vision"
      condition: has_images
      model: gemma-low
    - name: "Planner"
      condition: system_contains
      keywords: ["archivist", "plan"]
      model: gemma
    - name: "Builder"
      condition: system_contains
      keywords: ["build", "deploy"]
      model: qwen
```

| Request type | Rule matched | Model selected |
|---|---|---|
| User pastes a screenshot | "Vision" (first rule) | gemma-low |
| OpenCode plan agent is active | "Planner" | gemma |
| OpenCode build agent is active | "Builder" | qwen |
| Normal conversation | none (fallback) | qwen |
| Plan agent + image in same request | "Vision" (higher priority) | gemma-low |

---

## Context Runway Shield — How It Works

### The Compaction Death Loop Problem

In long coding sessions, the conversation history grows until it exceeds the model's context window.
llama.cpp's response — re-evaluating the entire context from scratch — is slow and can lock up your
GPU for minutes, making the IDE unresponsive.

### How the shield works

When the incoming payload exceeds `max_chars`:

1. The system prompt is extracted and **anchored** (never evicted)
2. The conversational history is separated
3. The **oldest user+assistant pairs are evicted atomically** until the payload fits within `target_trim_chars`
4. The trimmed history is reassembled with the system prompt at the top

```
Before:  [SYSTEM] [user1] [asst1] [user2] [asst2] [user3] [asst3]  ← 98,000 chars
                   ↑── evict this pair ──↑

After:   [SYSTEM] [user2] [asst2] [user3] [asst3]                   ← 62,000 chars
```

### Why atomic pair eviction matters

Evicting a single message (e.g., just `user1`) leaves an `assistant1` message without its
corresponding user turn. Many models strictly expect alternating `user → assistant` turns and will
produce degraded output — or refuse to respond — when this structure is broken.

The shield always evicts complete pairs, maintaining the correct conversation structure.

---

## Vision Sanitization — How It Works

### Problem 1: WebP images from Chromium

When you paste a screenshot from a Chromium browser into OpenCode, it sends the image as
`data:image/webp;base64,...`. The `llama-server` vision pipeline does not support WebP natively
and will crash with a `MUL_MAT` error.

**Solution:** The gateway detects `data:image/webp` URLs and replaces them with a minimal 1×1
transparent PNG. The conversation continues without the problematic image.

### Problem 2: Malformed Base64

Some clients send Base64-encoded images with:
- Embedded newlines (`\n`) or escaped newlines (`\\n`)
- URL-safe characters (`-` instead of `+`, `_` instead of `/`)
- Missing padding characters (`=`)

These are all repaired inline before the payload reaches llama-server.

---

## RAG Project Memory

The gateway can inject architectural decisions from a local `memory.jsonl` file into every
model's system prompt. This gives all models a shared, up-to-date view of your project's rules.

### File format

Each line is a JSON object:

```jsonl
{"category": "architecture", "decision": "Use native JS object mappers, not Zod validators", "context": "mappers.ts"}
{"category": "database", "decision": "Use SQLite via Bun's native SQL API, not an ORM", "context": "db layer"}
{"category": "style", "decision": "All API responses use camelCase, internal structs use snake_case", "context": "API contracts"}
```

> The file also supports plain text lines (one rule per line) for quick notes.

### How injection works

For each incoming request:
1. The top `always_inject_count` entries are always injected
2. Any entry whose `category` or `context` appears in the user prompt is also injected
3. The injected block is appended to the system prompt

**Injected system prompt addition:**

```
[PROJECT MEMORY]
Always honor these active architectural decisions:
- [ARCHITECTURE] Use native JS object mappers, not Zod validators (mappers.ts)
- [DATABASE] Use SQLite via Bun's native SQL API, not an ORM (db layer)
```

### Using with OpenCode's memory

OpenCode maintains its own `.opencode/memory.jsonl` file. You can point the gateway at the same
file so the gateway's RAG injection uses OpenCode's memory:

```yaml
memory:
  path: /path/to/your/project/.opencode/memory.jsonl
```

---

## OpenCode Integration — Full Guide

### What gets generated

Running the gateway produces `generated/opencode.jsonc` with:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",

  "model": "llama-gateway/qwen",          // your default_model
  "small_model": "llama-gateway/gemma-low",

  "provider": {
    "llama-gateway": {
      "name": "Llama Gateway (Local)",
      "options": {
        "baseURL": "http://127.0.0.1:8082/v1",
        "apiKey": "llama-gateway"           // required field, value doesn't matter
      },
      "models": {
        "qwen": { "name": "Qwen3.6 35B MoE (Executor)" },
        "gemma": { "name": "Gemma 26B Planner (Thinking)" },
        "gemma-low": { "name": "Gemma 4B Vision" }
      }
    }
  },

  "agent": {
    "plan":    { "model": "llama-gateway/gemma" },
    "build":   { "model": "llama-gateway/qwen" },
    "general": { "model": "llama-gateway/qwen" },
    "title":   { "model": "llama-gateway/gemma-low" },
    "summary": { "model": "llama-gateway/gemma-low" }
  }
}
```

### Option A — Project-level config (recommended for most users)

Copy the generated file to your project root:

```bash
# Windows
Copy-Item generated\opencode.jsonc opencode.jsonc

# Linux / macOS
cp generated/opencode.jsonc opencode.jsonc
```

This affects only that project. Safe to commit to git.

### Option B — Global config (affects all projects)

Merge the `provider`, `model`, `small_model`, and `agent` blocks into your global config:

```
Windows:  %APPDATA%\opencode\opencode.jsonc
Linux:    ~/.config/opencode/opencode.jsonc
macOS:    ~/.config/opencode/opencode.jsonc
```

Verify it worked:
```bash
opencode debug config
```

### Troubleshooting OpenCode connection

If the gateway provider doesn't appear in OpenCode:

1. **Check the gateway is running:** `curl http://127.0.0.1:8082/v1/models`
2. **Verify the config was loaded:** `opencode debug config` — look for `llama-gateway` in the providers list
3. **Check config precedence:** Project `opencode.jsonc` overrides global config. If you have both, make sure they don't conflict.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GATEWAY_CONFIG` | `./gateway.config.yaml` | Path to the config file |

Example:
```bash
GATEWAY_CONFIG=/etc/llama-gateway/prod.yaml bun start
```

---

## Hot-Reload Workflow

When `watch_config: true` is set (the default):

1. Edit `gateway.config.yaml` — add a model, change a flag, adjust a routing rule
2. The gateway detects the change on the next request (or on restart)
3. A new `llama-swap.yaml` is generated with the updated values
4. llama-swap detects the file change via `--watch-config` and applies it — **no downtime**

> **Note:** The hot-reload currently triggers on gateway restart. A file-watcher that triggers
> live regeneration without restart is planned for M3.

---

## Troubleshooting

### Gateway fails to start: "Cannot find executable"

```
[CONFIG] Cannot find "llama-swap" on PATH.
```

**Fix:** Set the full absolute path in `gateway.config.yaml`:

```yaml
llama_swap:
  executable: C:\Tools\llama-swap\llama-swap.exe
```

Or add the directory to your system PATH and restart your terminal.

---

### Gateway starts but OpenCode can't connect

1. Check the gateway is actually listening: `curl http://127.0.0.1:8082/v1/chat/completions -d '{"model":"test","messages":[]}'`
2. Check for port conflicts: `netstat -an | findstr 8082` (Windows) or `lsof -i :8082` (Linux/macOS)
3. Check your `opencode.jsonc` `baseURL` matches the gateway port

---

### Models not loading in llama-swap

1. Run `bun run test-gen` to preview the generated `llama-swap.yaml`
2. Check the model paths exist: they must be absolute paths to valid GGUF files
3. Check llama-swap's own logs (they stream directly to the gateway terminal)
4. Try running the generated `cmd` string directly in a terminal to see the raw llama-server error

---

### Context deflation logs every request

If you see `[SHIELD] Payload X chars exceeds limit` on every request, your models have very
large system prompts (common with OpenCode agents). Consider:

```yaml
context:
  max_chars: 150000       # increase if your model supports it
  target_trim_chars: 100000
```

Or reduce the `always_inject_count` in memory settings to inject fewer RAG entries.

---

### Vision routing fires on non-image requests

Check that your routing rules have `has_images` **first**:

```yaml
rules:
  - name: "Vision"
    condition: has_images     # ← must be first
    model: gemma-low
  - name: "Planner"
    ...
```

Rules are evaluated in order. If `system_contains` matches first and routes to a non-vision model,
then a later `has_images` rule is never reached.

---

### `--chat-template-kwargs` not working

Make sure the value is a valid JSON string in your YAML:

```yaml
chat_template_kwargs: '{"enable_thinking":true}'  # single-quoted YAML string
```

The generator will produce: `--chat-template-kwargs "{\"enable_thinking\":true}"` in the cmd string.

---

## Architecture Reference

```
bun start (index.ts)
│
├── loadConfig()                  src/config.ts
│   ├── Parse gateway.config.yaml (js-yaml)
│   ├── Validate required fields
│   ├── Expand ~ paths
│   └── Return typed GatewayConfig
│
├── resolveExecutable()           src/config.ts
│   ├── Bun.which() → PATH search (cross-platform)
│   └── Bun.file().exists() → absolute path fallback
│
├── generateLlamaSwapConfig()     src/generator/llama-swap.ts
│   ├── For each model: buildCmd()
│   │   ├── buildFlagArgs() → maps ModelFlags → CLI args
│   │   └── Appends extra_flags verbatim
│   └── Writes generated/llama-swap.yaml
│
├── generateOpenCodeConfig()      src/generator/opencode.ts
│   ├── Infers agent→model mapping from routing rules
│   └── Writes generated/opencode.jsonc
│
├── Bun.spawn(llama-swap)         index.ts
│   └── Streams llama-swap stdout/stderr to terminal
│
├── Readiness probe               index.ts
│   └── Polls GET /health until ready (max health_check_timeout)
│
└── Bun.serve(:gateway.port)      index.ts
    └── For each request:
        ├── sanitizeMessages()    src/middleware/sanitizer.ts
        ├── deflateContext()      src/middleware/context.ts
        ├── resolveModel()        src/middleware/router.ts
        ├── buildMemoryInjection() src/middleware/memory.ts
        └── proxyRequest()        src/proxy.ts
```

---

> **← [Back to README](README.MD)**
