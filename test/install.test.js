import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  buildLaunchAgentPlist,
  installBreakGuard,
  installClaudeHook,
  parseDurationMs,
} from "../scripts/install.js";
import { uninstallBreakGuard } from "../scripts/uninstall.js";

test("installClaudeHook preserves existing hooks and adds UserPromptSubmit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "break-guard-install-"));
  const settingsPath = join(dir, "settings.json");
  const backupDir = join(dir, "backups");
  const configPath = join(dir, "break-guard", "config.json");
  const command = "node /project/src/break-guard.js";

  try {
    await writeFile(
      settingsPath,
      `${JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                hooks: [
                  {
                    type: "command",
                    command: "python3 ~/.codex/notify.py",
                    async: true,
                  },
                ],
              },
            ],
            PermissionRequest: [
              {
                hooks: [
                  {
                    type: "command",
                    command: "python3 ~/.codex/notify.py approval",
                    async: true,
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );

    const result = await installClaudeHook({
      settingsPath,
      backupDir,
      configPath,
      command,
      backupName: "settings.json.test.bak",
    });

    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const backup = JSON.parse(
      await readFile(join(backupDir, "settings.json.test.bak"), "utf8"),
    );
    assert.equal(result.installed, true);
    assert.equal(settings.hooks.Stop[0].hooks[0].command, "python3 ~/.codex/notify.py");
    assert.equal(
      settings.hooks.PermissionRequest[0].hooks[0].command,
      "python3 ~/.codex/notify.py approval",
    );
    assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].command, command);
    assert.equal(config.mode, "strict");
    assert.equal(config.workDurationMs, 1_500_000);
    assert.equal(backup.hooks.UserPromptSubmit, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installClaudeHook is idempotent and does not duplicate the command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "break-guard-install-"));
  const settingsPath = join(dir, "settings.json");
  const backupDir = join(dir, "backups");
  const configPath = join(dir, "break-guard", "config.json");
  const command = "node /project/src/break-guard.js";

  try {
    await writeFile(
      settingsPath,
      `${JSON.stringify(
        {
          hooks: {
            UserPromptSubmit: [
              {
                hooks: [
                  {
                    type: "command",
                    command,
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );

    const result = await installClaudeHook({
      settingsPath,
      backupDir,
      configPath,
      command,
      backupName: "settings.json.test.bak",
    });

    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(result.installed, false);
    assert.equal(settings.hooks.UserPromptSubmit.length, 1);
    assert.equal(settings.hooks.UserPromptSubmit[0].hooks.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseDurationMs accepts minutes, hours, and seconds", () => {
  assert.equal(parseDurationMs("30m"), 1_800_000);
  assert.equal(parseDurationMs("1h"), 3_600_000);
  assert.equal(parseDurationMs("5s"), 5_000);
});

test("installBreakGuard writes config, launch agent, and starts monitor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "break-guard-install-"));
  const settingsPath = join(dir, "settings.json");
  const backupDir = join(dir, "backups");
  const configPath = join(dir, "break-guard", "config.json");
  const launchAgentPath = join(dir, "LaunchAgents", "com.test.break-guard.plist");
  const commands = [];

  try {
    const result = await installBreakGuard({
      settingsPath,
      backupDir,
      configPath,
      launchAgentPath,
      command: "node /project/src/break-guard.js",
      nodePath: "/usr/local/bin/node",
      monitorScriptPath: "/project/src/break-monitor.js",
      workingDirectory: "/project",
      label: "com.test.break-guard",
      workDurationMs: 30 * 60 * 1000,
      restDurationMs: 5 * 60 * 1000,
      monitorIntervalMs: 5 * 1000,
      backupName: "settings.json.test.bak",
      runCommand: (...args) => commands.push(args),
    });

    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const plist = await readFile(launchAgentPath, "utf8");

    assert.equal(result.hook.installed, true);
    assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].command, "node /project/src/break-guard.js");
    assert.equal(config.workDurationMs, 1_800_000);
    assert.equal(config.breakDurationMs, 300_000);
    assert.equal(config.idleRestThresholdMs, 300_000);
    assert.equal(config.monitorIntervalMs, 5_000);
    assert.match(plist, /com\.test\.break-guard/);
    assert.match(plist, /break-monitor\.js/);
    assert.deepEqual(commands.map((entry) => entry.slice(0, 2)), [
      ["launchctl", "bootout"],
      ["launchctl", "bootstrap"],
      ["launchctl", "kickstart"],
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildLaunchAgentPlist includes node, monitor, cwd, and HOME", () => {
  const plist = buildLaunchAgentPlist({
    label: "com.test.break-guard",
    nodePath: "/opt/node",
    monitorScriptPath: "/repo/src/break-monitor.js",
    workingDirectory: "/repo",
    home: "/Users/test",
    logPath: "/Users/test/.claude/break-guard/monitor.log",
  });

  assert.match(plist, /<string>\/opt\/node<\/string>/);
  assert.match(plist, /<string>\/repo\/src\/break-monitor\.js<\/string>/);
  assert.match(plist, /<string>\/repo<\/string>/);
  assert.match(plist, /<string>\/Users\/test<\/string>/);
});

test("uninstallBreakGuard removes only break guard hook and launch agent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "break-guard-uninstall-"));
  const settingsPath = join(dir, "settings.json");
  const backupDir = join(dir, "backups");
  const launchAgentPath = join(dir, "LaunchAgents", "com.test.break-guard.plist");
  const configDir = join(dir, "break-guard");
  const commands = [];

  try {
    await writeFile(
      settingsPath,
      `${JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                hooks: [
                  {
                    type: "command",
                    command: "python3 ~/.codex/notify.py",
                    async: true,
                  },
                ],
              },
            ],
            UserPromptSubmit: [
              {
                hooks: [
                  {
                    type: "command",
                    command: "node /project/src/break-guard.js",
                  },
                  {
                    type: "command",
                    command: "node /other/hook.js",
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );
    await mkdir(dirname(launchAgentPath), { recursive: true });
    await writeFile(launchAgentPath, "plist");
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "state.json"), "{}\n");

    const result = await uninstallBreakGuard({
      settingsPath,
      backupDir,
      launchAgentPath,
      configDir,
      command: "node /project/src/break-guard.js",
      label: "com.test.break-guard",
      backupName: "settings.json.uninstall-test.bak",
      removeConfig: true,
      runCommand: (...args) => commands.push(args),
    });

    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(result.removedHook, true);
    assert.equal(settings.hooks.Stop[0].hooks[0].command, "python3 ~/.codex/notify.py");
    assert.equal(settings.hooks.UserPromptSubmit[0].hooks.length, 1);
    assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].command, "node /other/hook.js");
    await assert.rejects(readFile(launchAgentPath, "utf8"), /ENOENT/);
    await assert.rejects(readFile(configDir, "utf8"), /ENOENT/);
    assert.deepEqual(commands.map((entry) => entry.slice(0, 2)), [
      ["launchctl", "bootout"],
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
