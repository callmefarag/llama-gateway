<div align="center">

# 🦙 llama-gateway

**Intelligent middleware proxy that bridges AI IDE clients to local llama.cpp inference engines.**

[![Bun](https://img.shields.io/badge/runtime-Bun-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![llama.cpp](https://img.shields.io/badge/backend-llama.cpp-green)](https://github.com/ggerganov/llama.cpp)
[![llama-swap](https://img.shields.io/badge/manager-llama--swap-orange)](https://github.com/mostlygeek/llama-swap)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

*Stop juggling model dropdowns. Stop fighting context crashes. One endpoint, all your models.*

</div>

---

## The Problem

Running multiple local models with AI IDEs like [OpenCode](https://opencode.ai), Roo Code, or Cline is painful:

- 💥 **Vision payloads crash llama.cpp** — Chromium sends WebP images that the C++ engine can't handle
- 🔄 **Context loops kill your PC** — long sessions balloon past the context window and lock up
- 🖱️ **Manual model switching** — you have to change dropdowns every time you switch tasks
- 🧠 **No shared project memory** — each model forgets your architectural decisions

**llama-gateway solves all of this.** It sits between your IDE client and `llama-swap`, silently fixing every payload before it reaches the engine.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [OpenCode Integration](#opencode-integration)
- [📖 Full Usage Guide & Capabilities](USAGE.md)

---

## How It Works

```
┌─────────────┐     ┌──────────────────────────────────────┐     ┌─────────────────┐
│  OpenCode   │────▶│           llama-gateway :8082         │────▶│  llama-swap     │
│  Roo Code   │     │                                       │     │  :8081          │
│  Cline      │     │  ① Sanitize vision (WebP → PNG)       │     │                 │
│  Any client │     │  ② Deflate context (pair eviction)    │     │  ┌───────────┐  │
│  (OpenAI    │     │  ③ Route by intent (image/plan/code)  │     │  │  qwen 35B │  │
│   compat.)  │     │  ④ Inject project memory (RAG)        │     │  │  gemma 26B│  │
└─────────────┘     │  ⑤ Forward to llama-swap              │     │  │  gemma 4B │  │
                    └──────────────────────────────────────┘     │  └───────────┘  │
                                                                   └─────────────────┘
```

The gateway **generates** the `llama-swap.yaml` from your single `gateway.config.yaml`, so you never maintain two config files.

---

## Features

| Feature | Description |
|---|---|
| 🔀 **Intent-Based Auto-Routing** | Detects vision payloads, planning tasks, and coding sessions — routes to the right model silently |
| 🛡️ **Context Runway Shield** | Evicts the oldest message *pairs* atomically when approaching the context limit — prevents the Compaction Death Loop |
| 🖼️ **Vision Asset Sanitization** | Intercepts Chromium WebP clipboard images and malformed Base64, repairs them before they crash the C++ engine |
| 🧠 **Dynamic RAG Memory** | Reads your local `memory.jsonl` and injects active architectural decisions into every model's system prompt |
| ⚙️ **Config-Driven** | One `gateway.config.yaml` generates both `llama-swap.yaml` and `opencode.jsonc` automatically |
| 🔁 **Hot-Reload** | Edit `gateway.config.yaml` → gateway regenerates → llama-swap picks it up via `--watch-config`, no restart needed |
| 🪟 **Cross-Platform** | Windows (PowerShell), Linux (bash), macOS (zsh) — executable resolution works natively on all platforms |

---

## Requirements

| Dependency | Purpose | Install |
|---|---|---|
| [Bun](https://bun.sh) | Gateway runtime | `curl -fsSL https://bun.sh/install \| bash` |
| [llama-swap](https://github.com/mostlygeek/llama-swap) | Multi-model memory manager | See releases page |
| [llama.cpp](https://github.com/ggerganov/llama.cpp) | Local inference engine (`llama-server`) | See releases page |
| GGUF model files | The actual models | [Hugging Face](https://huggingface.co) |

---

## Installation

### Option A — `bunx` (no install, run directly)

```bash
# Run without installing — always uses the latest version from npm
bunx llama-gateway
```

> Requires Bun. The first run downloads the package; subsequent runs use the cache.

### Option B — Install as a standalone binary (recommended)

Compiles to a native binary with **no runtime dependency** — Bun doesn't need to be installed on the target machine.

```bash
# Clone and install dependencies first
git clone https://github.com/callmefarag/llama-gateway
cd llama-gateway
bun install

# Compile + install to PATH automatically
bun run install-path
```

**What it does:**
- Compiles `index.ts` → single standalone executable via `bun build --compile`
- **Windows:** installs to `%APPDATA%\Local\Programs\llama-gateway\llama-gateway.exe`
- **Linux/macOS:** installs to `~/.local/bin/llama-gateway`
- Prints exact PATH setup instructions if the install directory isn't on PATH yet

**After install, run from anywhere:**
```bash
llama-gateway               # start the gateway (uses ./gateway.config.yaml in cwd)
llama-gateway --help        # show all options
llama-gateway --version     # print version
llama-gateway --install     # re-run the installer
```

### Option C — `bun link` (local development)

```bash
git clone https://github.com/callmefarag/llama-gateway
cd llama-gateway
bun install
bun link              # registers the `llama-gateway` command globally via Bun
```

### Option D — Global npm install (once published)

```bash
npm install -g llama-gateway
# or
bun install -g llama-gateway
```

---

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/callmefarag/llama-gateway
cd llama-gateway
bun install
```

### 2. Configure

Copy the example config and fill in your paths:

```bash
# Windows (PowerShell)
Copy-Item gateway.config.example.yaml gateway.config.yaml

# Linux / macOS
cp gateway.config.example.yaml gateway.config.yaml
```

Open `gateway.config.yaml` and set your executable paths and model files:

```yaml
llama_swap:
  executable: C:\Tools\llama-swap\llama-swap.exe   # or: llama-swap (if on PATH)

llama_server:
  executable: C:\Tools\llama-cpp\llama-server.exe   # or: llama-server (if on PATH)

models:
  - id: my-model
    label: "Qwen 35B (Coder)"
    model_path: D:\AI_Models\qwen35b.gguf
    flags:
      ngl: 99
      ctx_size: 32768
      flash_attn: true
```

> **See [USAGE.md](USAGE.md) for the full flag reference and all configuration options.**

### 3. Preview the generated configs (optional)

```bash
bun run test-gen
```

This writes `generated/llama-swap.yaml` and `generated/opencode.jsonc` without starting any process.

### 4. Run

```bash
bun start
```

The gateway will:
1. Load and validate `gateway.config.yaml`
2. Generate `generated/llama-swap.yaml` and `generated/opencode.jsonc`
3. Start `llama-swap` pointing at the generated config
4. Wait for llama-swap to be ready
5. Start the gateway server on `:8082`

**Output:**

```
════════════════════════════════════════════════════════════
  llama-gateway  ·  Bun v1.x.x
════════════════════════════════════════════════════════════

[CONFIG] Gateway port : 8082
[CONFIG] llama-swap   : 127.0.0.1:8081
[CONFIG] Models       : qwen (Qwen3.6 35B MoE), gemma (Gemma 26B), gemma-low (Gemma 4B)
[CONFIG] Default model: qwen

[EXEC] llama-swap   : C:\Tools\llama-swap\llama-swap.exe
[EXEC] llama-server : C:\Tools\llama-cpp\llama-server.exe

[GENERATOR] llama-swap config → .\generated\llama-swap.yaml
[GENERATOR] OpenCode config  → .\generated\opencode.jsonc

[SYSTEM] Waiting for llama-swap on http://127.0.0.1:8081…
[SYSTEM] llama-swap is ready ✓

════════════════════════════════════════════════════════════
  GATEWAY  ·  http://127.0.0.1:8082/v1
  SWAP     ·  http://127.0.0.1:8081
  OPENCODE ·  .\generated\opencode.jsonc
════════════════════════════════════════════════════════════
```

---

## Configuration

### Adding a model

In `gateway.config.yaml`, add an entry to the `models` list:

```yaml
models:
  - id: deepseek-r1
    label: "DeepSeek R1 32B (Reasoning)"
    model_path: /path/to/deepseek-r1-32b.gguf
    ttl: 300                    # unload after 5 minutes idle
    flags:
      ngl: 99
      ctx_size: 65536
      flash_attn: true
      cache_type_k: q8_0
      cache_type_v: q8_0
      cache_prompt: true
    extra_flags: "--reasoning on"   # any flag not in the `flags` block
```

Restart the gateway (or wait for hot-reload) — it shows up in OpenCode automatically.

### Routing rules

```yaml
routing:
  default_model: deepseek-r1
  rules:
    - name: "Vision"
      condition: has_images       # triggered when payload contains an image
      model: gemma-low

    - name: "Planner"
      condition: system_contains  # triggered when system prompt contains a keyword
      keywords: ["archivist", "plan"]
      model: gemma

    - name: "Coder"
      condition: user_contains    # triggered when user messages contain a keyword
      keywords: ["/build", "/fix"]
      model: deepseek-r1
```

---

## OpenCode Integration

After running the gateway, copy the generated config to your project:

```bash
# Windows
Copy-Item generated\opencode.jsonc opencode.jsonc

# Linux / macOS
cp generated/opencode.jsonc opencode.jsonc
```

Or merge the `provider` block into your global config for system-wide access:

```bash
# Inspect the generated file first
cat generated/opencode.jsonc

# Then add the provider block to your global config
# Windows: %APPDATA%\opencode\opencode.jsonc
# Linux/macOS: ~/.config/opencode/opencode.jsonc

# Verify the merge worked
opencode debug config
```

The generated config automatically routes OpenCode's built-in agents (`plan`, `build`, `general`, `title`, `summary`) to the appropriate model based on your routing rules.

---

## Development

```bash
# Watch mode — auto-restarts on file changes
bun run dev

# Type check
bun run --bun tsc --noEmit

# Test config + generators without starting any process
bun run test-gen
```

---

## Project Structure

```
llama-gateway/
├── gateway.config.yaml          Your personal config (gitignored)
├── gateway.config.example.yaml  Reference config with all options documented
├── generated/
│   ├── llama-swap.yaml          Auto-generated — do not edit
│   └── opencode.jsonc           Auto-generated — copy to your project
├── src/
│   ├── types.ts                 Shared TypeScript interfaces
│   ├── config.ts                YAML loader + cross-platform executable resolver
│   ├── generator/
│   │   ├── llama-swap.ts        Builds llama-swap.yaml from model definitions
│   │   └── opencode.ts          Builds opencode.jsonc from model definitions
│   └── middleware/
│       ├── sanitizer.ts         Vision asset sanitization
│       ├── context.ts           Context runway deflation shield
│       ├── router.ts            Intent-based model router
│       └── memory.ts            RAG project memory injection
├── src/proxy.ts                 SSE-aware HTTP proxy
└── index.ts                     Orchestrator (~100 lines)
```

---

## 📖 Full Documentation

For the complete flag reference, advanced routing, memory format, troubleshooting, and architecture deep-dive:

**[→ Read the Full Usage Guide (USAGE.md)](USAGE.md)**

---

## Roadmap

- [ ] **M2** — First-run setup wizard (`bun start --setup`)
- [ ] **M3** — Web Admin Panel (live routing log, model CRUD, config editor)
- [ ] **M4** — `--install-opencode` auto-write to global OpenCode config
- [ ] **M5** — `/v1/models` endpoint passthrough with unified model list

---

## License

MIT — see [LICENSE](LICENSE).