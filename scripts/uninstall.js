import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LAUNCH_AGENT_LABEL } from "./install.js";

export async function uninstallBreakGuard({
  settingsPath,
  backupDir,
  launchAgentPath,
  configDir,
  command,
  label = LAUNCH_AGENT_LABEL,
  backupName = `settings.json.uninstall-break-guard-${timestamp()}.bak`,
  removeConfig = false,
  runCommand = runCommandSync,
}) {
  const settings = await readJsonOrDefault(settingsPath, {});
  await mkdir(backupDir, { recursive: true });
  const backupPath = join(backupDir, backupName);
  await writeFile(backupPath, `${JSON.stringify(settings, null, 2)}\n`);

  const removedHook = removeHookCommand(settings, command);
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  const domain = `gui/${process.getuid?.() ?? ""}`;
  runCommand("launchctl", "bootout", domain, launchAgentPath);
  await rm(launchAgentPath, { force: true });

  if (removeConfig) {
    await rm(configDir, { recursive: true, force: true });
  }

  return {
    backupPath,
    removedHook,
    removedLaunchAgent: true,
    removedConfig: removeConfig,
  };
}

function removeHookCommand(settings, command) {
  const eventHooks = settings.hooks?.UserPromptSubmit;
  if (!Array.isArray(eventHooks)) {
    return false;
  }

  let removed = false;
  settings.hooks.UserPromptSubmit = eventHooks
    .map((entry) => {
      const hooks = (entry.hooks ?? []).filter((hook) => {
        if (hook.command === command) {
          removed = true;
          return false;
        }
        return true;
      });
      return {
        ...entry,
        hooks,
      };
    })
    .filter((entry) => (entry.hooks ?? []).length > 0);

  if (settings.hooks.UserPromptSubmit.length === 0) {
    delete settings.hooks.UserPromptSubmit;
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  return removed;
}

async function readJsonOrDefault(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

function runCommandSync(command, ...args) {
  try {
    execFileSync(command, args, { stdio: "inherit" });
  } catch (error) {
    if (command === "launchctl" && args[0] === "bootout") {
      return;
    }
    throw error;
  }
}

function timestamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}

async function main() {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME is required to locate Claude Code settings");
  }

  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const command = `node ${root}/src/break-guard.js`;
  const result = await uninstallBreakGuard({
    settingsPath: `${home}/.claude/settings.json`,
    backupDir: `${home}/.claude/backups`,
    launchAgentPath: `${home}/Library/LaunchAgents/${LAUNCH_AGENT_LABEL}.plist`,
    configDir: `${home}/.claude/break-guard`,
    command,
    removeConfig: process.argv.includes("--remove-config"),
  });

  process.stdout.write(`Removed hook: ${result.removedHook ? "yes" : "no"}\n`);
  process.stdout.write(`Backup: ${result.backupPath}\n`);
  process.stdout.write(`Removed LaunchAgent: yes\n`);
  if (result.removedConfig) {
    process.stdout.write("Removed break guard config and state.\n");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
