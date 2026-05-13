import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  getMacIdleMs,
  loadConfig,
  readState,
  recordRestCompletion,
  writeState,
} from "./break-guard.js";

export const DEFAULT_MONITOR_INTERVAL_MS = 5_000;

export async function runMonitorTick({
  statePath,
  configPath,
  nowMs = Date.now(),
  getIdleMs = getMacIdleMs,
}) {
  const config = await loadConfig(configPath);
  const state = await readState(statePath);
  const result = recordRestCompletion({
    nowMs,
    idleMs: getIdleMs(),
    state,
    config,
  });

  if (result.recorded) {
    await writeState(statePath, result.state);
  }

  return result;
}

export async function runMonitorLoop({
  statePath,
  configPath,
  intervalMs,
  getIdleMs = getMacIdleMs,
}) {
  const interval = Number.isFinite(intervalMs)
    ? intervalMs
    : await getConfiguredIntervalMs(configPath);

  for (;;) {
    try {
      await runMonitorTick({
        statePath,
        configPath,
        getIdleMs,
      });
    } catch (error) {
      process.stderr.write(`break monitor error: ${error.message}\n`);
    }

    await sleep(interval);
  }
}

async function getConfiguredIntervalMs(configPath) {
  const config = await loadConfig(configPath);
  return Number.isFinite(config.monitorIntervalMs)
    ? config.monitorIntervalMs
    : DEFAULT_MONITOR_INTERVAL_MS;
}

async function main() {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME is required to locate break guard state");
  }

  await runMonitorLoop({
    statePath: `${home}/.claude/break-guard/state.json`,
    configPath: `${home}/.claude/break-guard/config.json`,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}
