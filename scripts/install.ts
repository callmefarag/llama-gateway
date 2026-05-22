// =============================================================================
// scripts/install.ts — Self-install to PATH
//
// Compiles llama-gateway to a standalone Bun binary (no Bun runtime needed
// after compilation) and places it in the right directory for your platform.
//
// Usage:
//   bun run install-path        ← via npm script
//   llama-gateway --install     ← via CLI flag (after bunx install)
// =============================================================================

import { mkdir, copyFile, chmod } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir, platform } from "os";

const IS_WINDOWS = platform() === "win32";
const IS_MAC = platform() === "darwin";

// ── Resolve package root (works whether called from scripts/ or bin/) ─────────
const pkgRoot = new URL("../", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

// ── Determine install directory ───────────────────────────────────────────────
function getInstallDir(): string {
  if (IS_WINDOWS) {
    // Use AppData\Local\Programs\llama-gateway — always writable, no admin needed
    return join(homedir(), "AppData", "Local", "Programs", "llama-gateway");
  }
  // Linux / macOS — standard user-local bin directory
  return join(homedir(), ".local", "bin");
}

// ── Check if a directory is already on PATH ───────────────────────────────────
function isOnPath(dir: string): boolean {
  const sep = IS_WINDOWS ? ";" : ":";
  return (process.env["PATH"] ?? "")
    .split(sep)
    .some((p) => p.replace(/[/\\]+$/, "") === dir.replace(/[/\\]+$/, ""));
}

// ── Print PATH setup instructions ────────────────────────────────────────────
function printPathInstructions(installDir: string): void {
  console.log("\n" + "─".repeat(60));
  console.log("⚠  The install directory is NOT yet on your PATH.");
  console.log("─".repeat(60));

  if (IS_WINDOWS) {
    console.log(`
Add it permanently via PowerShell (run once):

  [Environment]::SetEnvironmentVariable(
    "PATH",
    [Environment]::GetEnvironmentVariable("PATH","User") + ";${installDir}",
    "User"
  )

Or for the current session only:

  $env:PATH += ";${installDir}"

Then restart your terminal and run: llama-gateway
`);
  } else {
    const shellProfile = IS_MAC ? "~/.zshrc" : "~/.bashrc";
    console.log(`
Add it permanently — append this line to ${shellProfile}:

  export PATH="$HOME/.local/bin:$PATH"

Then reload:

  source ${shellProfile}

Or for the current session only:

  export PATH="$HOME/.local/bin:$PATH"

Then run: llama-gateway
`);
  }
}

// ── Automatically add directory to PATH ───────────────────────────────────────
async function ensurePath(dir: string): Promise<void> {
  console.log("[PATH] Checking environment PATH…");
  
  if (isOnPath(dir)) {
    console.log("      ✓ Install directory is already active on your PATH.\n");
    return;
  }

  console.log("      ⚠ Install directory is not active on your PATH. Attempting to add it…");

  if (IS_WINDOWS) {
    try {
      const getPathProc = Bun.spawn(["powershell", "-Command", "[Environment]::GetEnvironmentVariable('PATH','User')"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await getPathProc.exited;
      const userPath = (await new Response(getPathProc.stdout).text()).trim();

      const inUserPath = userPath
        .split(";")
        .some((p) => p.replace(/[/\\]+$/, "") === dir.replace(/[/\\]+$/, ""));

      if (!inUserPath) {
        const newPath = userPath ? `${userPath};${dir}` : dir;
        const setPathProc = Bun.spawn([
          "powershell",
          "-Command",
          `[Environment]::SetEnvironmentVariable('PATH', '${newPath.replace(/'/g, "''")}', 'User')`
        ]);
        const exitCode = await setPathProc.exited;
        if (exitCode === 0) {
          console.log("      ✓ Successfully added to your persistent User PATH environment variable.");
          console.log("      ⚠ Please restart your terminal/editor to apply the changes.\n");
        } else {
          console.log("      ⚠ Failed to update registry PATH automatically.");
          printPathInstructions(dir);
        }
      } else {
        console.log("      ✓ Already present in your persistent User PATH registry.");
        console.log("      ⚠ Please restart your terminal/editor to activate it in this session.\n");
      }
    } catch (err) {
      console.warn("      ⚠ Could not auto-add to PATH:", err);
      printPathInstructions(dir);
    }
  } else {
    try {
      const shell = process.env["SHELL"] ?? "";
      let profilePath = "";
      if (shell.includes("zsh")) {
        profilePath = join(homedir(), ".zshrc");
      } else if (shell.includes("bash")) {
        profilePath = join(homedir(), ".bashrc");
      } else {
        profilePath = existsSync(join(homedir(), ".zshrc"))
          ? join(homedir(), ".zshrc")
          : join(homedir(), ".bashrc");
      }

      const exportLine = `export PATH="$HOME/.local/bin:$PATH"`;

      if (existsSync(profilePath)) {
        const content = await Bun.file(profilePath).text();
        if (!content.includes(exportLine)) {
          const separator = content.endsWith("\n") ? "" : "\n";
          await Bun.write(profilePath, `${content}${separator}${exportLine}\n`);
          console.log(`      ✓ Added path configuration to ${profilePath}`);
          console.log(`      ⚠ Please run 'source ${profilePath}' or restart your terminal to apply.\n`);
        } else {
          console.log(`      ✓ Path configuration is already present in ${profilePath}`);
          console.log(`      ⚠ Please run 'source ${profilePath}' or restart your terminal if not yet active.\n`);
        }
      } else {
        console.log(`      ⚠ Profile file ${profilePath} not found.`);
        printPathInstructions(dir);
      }
    } catch (err) {
      console.warn("      ⚠ Could not auto-add to PATH:", err);
      printPathInstructions(dir);
    }
  }
}

// ── Main install flow ─────────────────────────────────────────────────────────
const installDir = getInstallDir();
const binaryName = IS_WINDOWS ? "llama-gateway.exe" : "llama-gateway";
const outPath = join(installDir, binaryName);
const entryPoint = join(pkgRoot, "bin", "llama-gateway.ts");

console.log("\n" + "═".repeat(60));
console.log("  llama-gateway — Self Installer");
console.log("═".repeat(60));
console.log(`  Platform  : ${platform()} (${IS_WINDOWS ? "Windows" : IS_MAC ? "macOS" : "Linux"})`);
console.log(`  Entry     : ${entryPoint}`);
console.log(`  Output    : ${outPath}`);
console.log("═".repeat(60) + "\n");

await ensurePath(installDir);

// ── Step 1: Ensure install directory exists ───────────────────────────────────
console.log("[1/3] Creating install directory…");
await mkdir(installDir, { recursive: true });
console.log(`      ✓ ${installDir}`);

// ── Step 2: Compile to standalone binary ─────────────────────────────────────
console.log("\n[2/3] Compiling standalone binary (this may take 10–30 seconds)…");
console.log("      bun build --compile --minify …\n");

const buildProc = Bun.spawn(
  [
    "bun",
    "build",
    "--compile",
    "--minify",
    `--outfile=${outPath}`,
    entryPoint,
  ],
  {
    cwd: pkgRoot,
    stdout: "inherit",
    stderr: "inherit",
  }
);

const exitCode = await buildProc.exited;

if (exitCode !== 0) {
  console.error("\n[INSTALL] ✗ Compilation failed. See errors above.");
  process.exit(1);
}

// ── Step 3: Make executable on Unix ──────────────────────────────────────────
if (!IS_WINDOWS && existsSync(outPath)) {
  await chmod(outPath, 0o755);
}

// ── Done ──────────────────────────────────────────────────────────────────────
console.log("\n[3/3] Verifying binary…");
const verifyProc = Bun.spawn([outPath, "--version"], {
  stdout: "pipe",
  stderr: "pipe",
});
const verifyExit = await verifyProc.exited;
const versionOut = await new Response(verifyProc.stdout).text();

if (verifyExit === 0) {
  console.log(`      ✓ ${versionOut.trim()}`);
} else {
  console.warn("      ⚠ Could not verify binary — it may still work.");
}

console.log("\n" + "═".repeat(60));
console.log(`  ✓ Installed: ${outPath}`);
console.log("═".repeat(60));

// ── PATH check ────────────────────────────────────────────────────────────────
if (isOnPath(installDir)) {
  console.log("\n  ✓ Ready! You can run: llama-gateway\n");
} else {
  console.log("\n  ⚠ Please restart your terminal session to begin using: llama-gateway\n");
}
