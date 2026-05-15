import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_CONFIG } from "../src/break-guard.js";

export const LAUNCH_AGENT_LABEL = "com.yhurri.claude-code-break-guard.monitor";

export async function installClaudeHook({
  settingsPath,
  backupDir,
  configPath,
  command,
  backupName = `settings.json.break-guard-${timestamp()}.bak`,
}) {
  const settings = await readJsonOrDefault(settingsPath, {});
  const existingText = `${JSON.stringify(settings, null, 2)}\n`;

  settings.hooks ??= {};
  settings.hooks.UserPromptSubmit ??= [];

  if (hasHookCommand(settings.hooks.UserPromptSubmit, command)) {
    await writeDefaultConfigIfMissing(configPath);
    return {
      installed: false,
      settingsPath,
      backupPath: null,
    };
  }

  await mkdir(backupDir, { recursive: true });
  const backupPath = join(backupDir, backupName);
  await writeFile(backupPath, existingText);
  await writeDefaultConfigIfMissing(configPath);

  settings.hooks.UserPromptSubmit.push({
    hooks: [
      {
        type: "command",
        command,
      },
    ],
  });

  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  return {
    installed: true,
    settingsPath,
    backupPath,
  };
}

export async function installBreakGuard({
  settingsPath,
  backupDir,
  configPath,
  launchAgentPath,
  command,
  nodePath,
  monitorScriptPath,
  workingDirectory,
  label = LAUNCH_AGENT_LABEL,
  home = process.env.HOME,
  logPath = `${home}/.claude/break-guard/monitor.log`,
  workDurationMs = DEFAULT_CONFIG.workDurationMs,
  restDurationMs = DEFAULT_CONFIG.idleRestThresholdMs,
  monitorIntervalMs = 5_000,
  mode = DEFAULT_CONFIG.mode,
  backupName,
  runCommand = runCommandSync,
}) {
  const hook = await installClaudeHook({
    settingsPath,
    backupDir,
    configPath,
    command,
    backupName,
  });

  await writeConfig(configPath, {
    ...DEFAULT_CONFIG,
    mode,
    workDurationMs,
    breakDurationMs: restDurationMs,
    idleRestThresholdMs: restDurationMs,
    monitorIntervalMs,
  });

  const plist = buildLaunchAgentPlist({
    label,
    nodePath,
    monitorScriptPath,
    workingDirectory,
    home,
    logPath,
  });
  await mkdir(dirname(launchAgentPath), { recursive: true });
  await writeFile(launchAgentPath, plist);

  const domain = `gui/${process.getuid?.() ?? ""}`;
  runCommand("launchctl", "bootout", domain, launchAgentPath);
  runCommand("launchctl", "bootstrap", domain, launchAgentPath);
  runCommand("launchctl", "kickstart", "-k", `${domain}/${label}`);

  return {
    hook,
    launchAgentPath,
    configPath,
  };
}

export function parseDurationMs(value) {
  const match = String(value).trim().match(/^(\d+)(ms|s|m|h)$/);
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === "ms") return amount;
  if (unit === "s") return amount * 1_000;
  if (unit === "m") return amount * 60_000;
  return amount * 60 * 60_000;
}

export function buildLaunchAgentPlist({
  label,
  nodePath,
  monitorScriptPath,
  workingDirectory,
  home,
  logPath,
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(monitorScriptPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(workingDirectory)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${escapeXml(home)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`;
}

async function writeDefaultConfigIfMissing(configPath) {
  try {
    await readFile(configPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  }
}

async function writeConfig(configPath, config) {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function hasHookCommand(eventHooks, command) {
  return eventHooks.some((matcher) =>
    (matcher.hooks ?? []).some((hook) => hook.command === command),
  );
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

function timestamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
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

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === "--work") {
      options.workDurationMs = parseDurationMs(argv[++index]);
    } else if (entry === "--rest") {
      options.restDurationMs = parseDurationMs(argv[++index]);
    } else if (entry === "--monitor-interval") {
      options.monitorIntervalMs = parseDurationMs(argv[++index]);
    } else if (entry === "--mode") {
      options.mode = argv[++index];
    }
  }
  return options;
}

async function main() {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME is required to locate Claude Code settings");
  }

  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const options = parseArgs(process.argv.slice(2));
  const result = await installBreakGuard({
    settingsPath: `${home}/.claude/settings.json`,
    backupDir: `${home}/.claude/backups`,
    configPath: `${home}/.claude/break-guard/config.json`,
    launchAgentPath: `${home}/Library/LaunchAgents/${LAUNCH_AGENT_LABEL}.plist`,
    command: `node ${root}/src/break-guard.js`,
    nodePath: process.execPath,
    monitorScriptPath: `${root}/src/break-monitor.js`,
    workingDirectory: root,
    home,
    logPath: `${home}/.claude/break-guard/monitor.log`,
    ...options,
  });

  if (result.hook.installed) {
    process.stdout.write(`Installed UserPromptSubmit hook.\nBackup: ${result.hook.backupPath}\n`);
  } else {
    process.stdout.write("UserPromptSubmit hook is already installed.\n");
  }
  process.stdout.write(`Installed monitor LaunchAgent: ${result.launchAgentPath}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
