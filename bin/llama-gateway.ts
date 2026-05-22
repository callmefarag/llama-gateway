#!/usr/bin/env bun
// =============================================================================
// llama-gateway — CLI entry point
// This file is the `bin` target that bunx / bun link / npm -g uses.
//
// Usage after installation:
//   llama-gateway            → start the gateway
//   llama-gateway --setup    → (coming M2) first-run setup wizard
//   llama-gateway --install  → compile & install binary to PATH
//   llama-gateway --version  → print version
// =============================================================================

const args = process.argv.slice(2);

import pkg from "../package.json";

if (args.includes("--version") || args.includes("-v")) {
  console.log(`llama-gateway v${pkg.version}`);
  process.exit(0);
}

if (args.includes("--install")) {
  await import("../scripts/install");
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
llama-gateway — Intelligent proxy for local llama.cpp inference

USAGE
  llama-gateway [options]

OPTIONS
  (none)          Start the gateway using ./gateway.config.yaml
  --install       Compile to a standalone binary and install to PATH
  --version, -v   Print the version number
  --help, -h      Show this help message

ENVIRONMENT
  GATEWAY_CONFIG  Path to config file (default: ./gateway.config.yaml)

EXAMPLES
  # Start the gateway
  llama-gateway

  # Use a custom config file
  GATEWAY_CONFIG=/etc/llama-gateway/prod.yaml llama-gateway

  # Install to PATH as a standalone binary
  llama-gateway --install

DOCS
  https://github.com/callmefarag/llama-gateway/blob/main/USAGE.md
`);
  process.exit(0);
}

// Default: start the gateway
await import("../index");
