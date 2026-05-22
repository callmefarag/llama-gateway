import { platform, homedir } from "os";
import { existsSync } from "fs";
import { join, isAbsolute, resolve } from "path";
import { resolveExecutable, CONFIG_FILE } from "./config";

interface ResolveOpts {
  name: string; // e.g. "llama-swap" or "llama-server"
  configuredValue: string; // the value currently in the config file
  configSection: "llama_swap" | "llama_server";
}

/**
 * Resolves an executable, or shows an interactive CLI setup wizard if it cannot be found.
 */
export async function resolveOrSetupExecutable(opts: ResolveOpts): Promise<string> {
  try {
    return await resolveExecutable(opts.configuredValue);
  } catch (err: any) {
    console.error(`\n┌${"─".repeat(70)}┐`);
    console.error(`│  ⚠  CONFIGURATION ERROR: Dependency "${opts.name}" Not Found`.padEnd(71) + "│");
    console.error(`└${"─".repeat(70)}┘`);
    console.error(`llama-gateway could not resolve "${opts.name}" (configured as "${opts.configuredValue}").\n`);
    console.error(`Search status:`);
    console.error(`  ✗ PATH   : Checked system PATH`);
    console.error(`  ✗ Config : Checked relative/absolute paths\n`);

    if (!process.stdin.isTTY) {
      console.error(`[SYSTEM] Terminal is non-interactive. Cannot launch prompt wizard.`);
      printManualInstructions(opts.name, platform() === "win32");
      process.exit(1);
    }

    return await runSetupWizard(opts);
  }
}

/**
 * Runs the interactive terminal setup wizard.
 */
async function runSetupWizard(opts: ResolveOpts): Promise<string> {
  const isWin = platform() === "win32";

  while (true) {
    console.log(`Please choose how you want to resolve this dependency:`);
    console.log(`  [1] Add the executable's folder to system PATH programmatically (requires restart)`);
    console.log(`  [2] Configure its absolute path in gateway.config.yaml (runs immediately)`);
    console.log(`  [3] Show manual setup instructions`);
    console.log(`  [4] Exit`);
    console.log();

    const choice = prompt(`Enter choice (1-4): `)?.trim();
    if (!choice || choice === "4") {
      console.log(`Exiting llama-gateway.`);
      process.exit(1);
    }

    if (choice === "1") {
      const success = await handlePathAutoAdd(opts);
      if (success) {
        console.log(`\n✓ PATH successfully modified.`);
        console.log(`⚠ Please restart your terminal/editor to apply environment changes and run llama-gateway again.`);
        process.exit(0);
      }
    } else if (choice === "2") {
      const resolvedPath = await handleConfigAutoUpdate(opts);
      if (resolvedPath) {
        console.log(`\n✓ Config successfully updated! Gateway will now boot using this path.`);
        return resolvedPath;
      }
    } else if (choice === "3") {
      printManualInstructions(opts.name, isWin);
      console.log(`\nPress Enter to return to the menu…`);
      prompt("");
      console.log();
    } else {
      console.log(`⚠ Invalid choice. Please enter 1, 2, 3, or 4.\n`);
    }
  }
}

/**
 * Resolves ~ home paths and makes a directory path absolute.
 */
function resolveDirPath(dir: string): string {
  let expanded = dir;
  if (dir === "~" || dir.startsWith("~/") || dir.startsWith("~\\")) {
    expanded = dir.replace(/^~/, homedir());
  }
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

/**
 * Option 1: Prompts user for executable's directory and automatically appends it to system PATH.
 */
async function handlePathAutoAdd(opts: ResolveOpts): Promise<boolean> {
  const isWin = platform() === "win32";
  const binaryName = isWin ? `${opts.name}.exe` : opts.name;

  console.log(`\n--- Add directory to PATH ---`);
  console.log(`Please enter the directory containing "${binaryName}" (e.g. ${isWin ? "C:\\Tools\\llama-swap" : "/usr/local/bin"}):`);
  const inputDir = prompt(`Directory: `)?.trim();

  if (!inputDir) {
    console.log(`⚠ Operation cancelled.`);
    return false;
  }

  const resolvedDir = resolveDirPath(inputDir);
  if (!existsSync(resolvedDir)) {
    console.log(`⚠ Directory does not exist: "${resolvedDir}"`);
    return false;
  }

  const exePath = join(resolvedDir, binaryName);
  if (!existsSync(exePath)) {
    console.log(`⚠ Executable "${binaryName}" was not found in directory "${resolvedDir}".`);
    return false;
  }

  try {
    if (isWin) {
      // Fetch current User PATH
      const getPathProc = Bun.spawn(["powershell", "-Command", "[Environment]::GetEnvironmentVariable('PATH','User')"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await getPathProc.exited;
      const userPath = (await new Response(getPathProc.stdout).text()).trim();

      const inUserPath = userPath
        .split(";")
        .some((p) => p.replace(/[/\\]+$/, "") === resolvedDir.replace(/[/\\]+$/, ""));

      if (!inUserPath) {
        const newPath = userPath ? `${userPath};${resolvedDir}` : resolvedDir;
        const setPathProc = Bun.spawn([
          "powershell",
          "-Command",
          `[Environment]::SetEnvironmentVariable('PATH', '${newPath.replace(/'/g, "''")}', 'User')`
        ]);
        const exitCode = await setPathProc.exited;
        if (exitCode === 0) {
          console.log(`✓ Successfully added "${resolvedDir}" to user PATH in registry.`);
          return true;
        } else {
          console.error(`⚠ Failed to write PATH variable to registry.`);
          return false;
        }
      } else {
        console.log(`✓ Directory is already present in your User PATH registry.`);
        return true;
      }
    } else {
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

      const exportLine = `export PATH="${resolvedDir}:$PATH"`;
      if (existsSync(profilePath)) {
        const content = await Bun.file(profilePath).text();
        if (!content.includes(exportLine)) {
          const separator = content.endsWith("\n") ? "" : "\n";
          await Bun.write(profilePath, `${content}${separator}${exportLine}\n`);
          console.log(`✓ Successfully appended path to profile file ${profilePath}.`);
          return true;
        } else {
          console.log(`✓ Export statement already present in ${profilePath}.`);
          return true;
        }
      } else {
        console.error(`⚠ Profile file ${profilePath} not found.`);
        return false;
      }
    }
  } catch (err: any) {
    console.error(`⚠ Error updating environment: ${err.message}`);
    return false;
  }
}

/**
 * Option 2: Prompts user for full file path and updates gateway.config.yaml.
 */
async function handleConfigAutoUpdate(opts: ResolveOpts): Promise<string | null> {
  const isWin = platform() === "win32";
  const binaryName = isWin ? `${opts.name}.exe` : opts.name;

  console.log(`\n--- Configure absolute path in config file ---`);
  console.log(`Please enter the full absolute path to the "${binaryName}" binary:`);
  const inputPath = prompt(`File path: `)?.trim();

  if (!inputPath) {
    console.log(`⚠ Operation cancelled.`);
    return null;
  }

  const resolvedPath = resolveDirPath(inputPath);
  if (!existsSync(resolvedPath)) {
    console.log(`⚠ File does not exist: "${resolvedPath}"`);
    return null;
  }

  const lowerPath = resolvedPath.toLowerCase();
  if (!lowerPath.endsWith(binaryName.toLowerCase())) {
    console.log(`⚠ Path does not end with "${binaryName}". Are you sure you entered the correct file path?`);
    const confirm = prompt(`Proceed anyway? (y/N): `)?.trim().toLowerCase();
    if (confirm !== "y" && confirm !== "yes") {
      return null;
    }
  }

  try {
    const configPath = resolve(process.cwd(), CONFIG_FILE);
    if (!existsSync(configPath)) {
      console.error(`⚠ Configuration file not found at: ${configPath}`);
      return null;
    }

    const content = await Bun.file(configPath).text();
    const updatedContent = updateConfigExecutable(content, opts.configSection, resolvedPath);
    await Bun.write(configPath, updatedContent);
    console.log(`✓ Successfully updated "${opts.configSection}.executable" in gateway.config.yaml.`);
    return resolvedPath;
  } catch (err: any) {
    console.error(`⚠ Error updating config file: ${err.message}`);
    return null;
  }
}

/**
 * Comment-preserving YAML modifier that swaps the executable path for a specific section.
 */
function updateConfigExecutable(
  configContent: string,
  section: "llama_swap" | "llama_server",
  newPath: string
): string {
  const lines = configContent.split(/\r?\n/);
  let currentSection: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // Detect top-level section headers, e.g. "llama_swap:"
    const sectionMatch = line.match(/^([a-zA-Z0-9_-]+)\s*:/);
    if (sectionMatch) {
      currentSection = sectionMatch[1] ?? null;
      continue;
    }

    // Detect reset of section if we hit another top-level key or no indentation
    if (line.trim() !== "" && !line.startsWith(" ") && !line.startsWith("#")) {
      currentSection = null;
    }

    if (currentSection === section) {
      // Find the executable line (indented)
      if (line.match(/^\s+executable\s*:/)) {
        const indent = line.match(/^(\s+)/)?.[0] ?? "  ";
        const normalizedPath = newPath.replace(/\\/g, "/"); // Bun accepts forward slashes on Windows too
        lines[i] = `${indent}executable: ${normalizedPath}`;
        break;
      }
    }
  }
  return lines.join("\n");
}

/**
 * Option 3: Print manual setup instructions.
 */
function printManualInstructions(name: string, isWin: boolean): void {
  console.log(`\n--- Manual Setup Instructions ---`);
  if (isWin) {
    console.log(`1. Locate the directory containing "${name}.exe" (e.g. C:\\Tools\\llama-swap).`);
    console.log(`2. Open PowerShell as User and run this command to add it to your PATH:`);
    console.log(`   [Environment]::SetEnvironmentVariable("PATH", [Environment]::GetEnvironmentVariable("PATH","User") + ";C:\\Tools\\${name}", "User")`);
    console.log(`3. Or configure the absolute path directly in gateway.config.yaml:`);
    console.log(`   ${name === "llama-swap" ? "llama_swap" : "llama_server"}:`);
    console.log(`     executable: C:/Tools/${name}/${name}.exe`);
  } else {
    console.log(`1. Locate the directory containing "${name}" (e.g. /usr/local/bin).`);
    console.log(`2. Add it to your shell configuration (e.g. ~/.zshrc or ~/.bashrc):`);
    console.log(`   export PATH="/path/to/directory:$PATH"`);
    console.log(`3. Or configure the absolute path directly in gateway.config.yaml:`);
    console.log(`   ${name === "llama-swap" ? "llama_swap" : "llama_server"}:`);
    console.log(`     executable: /usr/local/bin/${name}`);
  }
}
