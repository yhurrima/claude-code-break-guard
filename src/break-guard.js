import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_CONFIG = Object.freeze({
  mode: "strict",
  workDurationMs: 30 * 60 * 1000,
  breakDurationMs: 5 * 60 * 1000,
  idleRestThresholdMs: 5 * 60 * 1000,
  minRestChunkMs: 60 * 1000,
  emergencySkipDurationMs: 2 * 60 * 1000,
});

export const EMERGENCY_PROMPT = "BREAK_GUARD_EMERGENCY";

export function decidePrompt({
  nowMs,
  idleMs,
  state,
  config = DEFAULT_CONFIG,
}) {
  const safeState = state ?? {};
  if (
    Number.isFinite(safeState.skipBreakUntilMs) &&
    nowMs < safeState.skipBreakUntilMs
  ) {
    return allowWithState(safeState);
  }

  const breakStartedAtMs = getBreakStartedAtMs(safeState, config);

  if (Number.isFinite(breakStartedAtMs)) {
    if (
      Number.isFinite(safeState.restCompletedAtMs) &&
      safeState.restCompletedAtMs >= breakStartedAtMs
    ) {
      return allowWithFreshTimer(nowMs, safeState);
    }

    if (idleMs >= config.idleRestThresholdMs) {
      return allowWithFreshTimer(nowMs, {
        ...safeState,
        restCompletedAtMs: nowMs,
      });
    }

    const remainingRestMs = getRemainingRestMs({
      idleMs,
      state: safeState,
      config,
    });
    return blockWithRequiredIdle(safeState, remainingRestMs);
  }

  if (idleMs >= config.idleRestThresholdMs) {
    return allowWithFreshTimer(nowMs, safeState);
  }

  if (!Number.isFinite(safeState.workStartedAtMs)) {
    return allowWithState({
      ...safeState,
      workStartedAtMs: nowMs,
      breakUntilMs: undefined,
    });
  }

  const workedMs = nowMs - safeState.workStartedAtMs;
  if (workedMs >= config.workDurationMs) {
    const breakUntilMs = nowMs + config.breakDurationMs;
    return blockWithRemaining(
      {
        ...safeState,
        breakStartedAtMs: nowMs,
        breakUntilMs,
      },
      config.breakDurationMs,
    );
  }

  return allowWithState(safeState);
}

export function formatRemaining(remainingMs) {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `${minutes} 分钟`;
}

export function parseMacIdleMs(output) {
  const match = output.match(/"HIDIdleTime"\s*=\s*(\d+)/);
  if (!match) {
    throw new Error("Cannot find HIDIdleTime in ioreg output");
  }

  return Math.floor(Number(match[1]) / 1_000_000);
}

export function getMacIdleMs() {
  const output = execFileSync("ioreg", ["-c", "IOHIDSystem"], {
    encoding: "utf8",
  });
  return parseMacIdleMs(output);
}

export function sendMacNotification(message) {
  try {
    execFileSync(
      "osascript",
      [
        "-e",
        `display notification ${JSON.stringify(message)} with title "Claude Code Break Guard" sound name "Glass"`,
      ],
      {
        stdio: "ignore",
      },
    );
  } catch {
    // Blocking should still work if macOS notifications are unavailable.
  }
}

export async function loadConfig(configPath) {
  try {
    const config = JSON.parse(await readFile(configPath, "utf8"));
    return {
      ...DEFAULT_CONFIG,
      ...config,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return DEFAULT_CONFIG;
    }
    throw error;
  }
}

export function recordRestCompletion({
  nowMs,
  idleMs,
  state,
  config = DEFAULT_CONFIG,
}) {
  const safeState = state ?? {};
  const breakStartedAtMs = getBreakStartedAtMs(safeState, config);
  if (!Number.isFinite(breakStartedAtMs)) {
    if (
      Number.isFinite(safeState.workStartedAtMs) &&
      idleMs >= config.idleRestThresholdMs
    ) {
      return {
        recorded: true,
        state: stripUndefined({
          ...safeState,
          workStartedAtMs: nowMs,
          restAccumulatedMs: undefined,
          lastIdleObservedMs: undefined,
          lastCountedIdleMs: undefined,
          restCompletedAtMs: undefined,
        }),
      };
    }

    return {
      recorded: false,
      state: safeState,
    };
  }

  if (
    Number.isFinite(safeState.restCompletedAtMs) &&
    safeState.restCompletedAtMs >= breakStartedAtMs
  ) {
    return {
      recorded: false,
      state: safeState,
    };
  }

  const restAccumulatedMs = getRestAccumulatedMs({
    idleMs,
    state: safeState,
    config,
  });

  if (restAccumulatedMs < config.idleRestThresholdMs) {
    return {
      recorded: restAccumulatedMs !== (safeState.restAccumulatedMs ?? 0),
      state: stripUndefined({
        ...safeState,
        restAccumulatedMs: restAccumulatedMs > 0 ? restAccumulatedMs : undefined,
        lastIdleObservedMs: idleMs,
        lastCountedIdleMs: getLastCountedIdleMs({
          idleMs,
          restAccumulatedMs,
          state: safeState,
          config,
        }),
      }),
    };
  }

  return {
    recorded: true,
    state: stripUndefined({
      ...safeState,
      restAccumulatedMs,
      lastIdleObservedMs: idleMs,
      lastCountedIdleMs: idleMs,
      restCompletedAtMs: nowMs,
    }),
  };
}

export async function runUserPromptSubmitHook({
  stdinText,
  statePath,
  nowMs = Date.now(),
  getIdleMs = getMacIdleMs,
  config = DEFAULT_CONFIG,
  notifyUser = sendMacNotification,
}) {
  const input = JSON.parse(stdinText);

  const state = await readState(statePath);
  if (input.prompt?.trim() === EMERGENCY_PROMPT) {
    const result = activateEmergencyOverride({
      nowMs,
      state,
      config,
    });
    await writeState(statePath, result.state);
    notifyUser(result.reason);

    return {
      exitCode: 0,
      stdout: `${JSON.stringify({
        decision: "block",
        reason: result.reason,
      })}\n`,
      stderr: "",
    };
  }

  const result = decidePrompt({
    nowMs,
    idleMs: getIdleMs(),
    state,
    config,
  });

  await writeState(statePath, result.state);

  if (result.decision === "block") {
    notifyUser(result.reason);
    return {
      exitCode: 2,
      stdout: "",
      stderr: `${result.reason}\n`,
    };
  }

  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
  };
}

function activateEmergencyOverride({ nowMs, state, config }) {
  const skipBreakUntilMs = nowMs + config.emergencySkipDurationMs;
  return {
    reason: `已开启紧急跳过，未来 ${formatRemaining(config.emergencySkipDurationMs)}内不会强制休息。`,
    state: stripUndefined({
      ...state,
      workStartedAtMs: nowMs,
      breakStartedAtMs: undefined,
      breakUntilMs: undefined,
      restCompletedAtMs: undefined,
      skipBreakUntilMs,
    }),
  };
}

function allowWithFreshTimer(nowMs, state) {
  return allowWithState({
    ...state,
    workStartedAtMs: nowMs,
    breakStartedAtMs: undefined,
    breakUntilMs: undefined,
    restCompletedAtMs: undefined,
    restAccumulatedMs: undefined,
    lastIdleObservedMs: undefined,
    lastCountedIdleMs: undefined,
  });
}

function allowWithState(state) {
  return {
    decision: "allow",
    state: stripUndefined(state),
  };
}

function blockWithRemaining(state, remainingMs) {
  return {
    decision: "block",
    reason: `强制休息中，还剩 ${formatRemaining(remainingMs)}。请离开电脑休息一下。`,
    state: stripUndefined(state),
  };
}

function blockWithRequiredIdle(state, remainingIdleMs) {
  return {
    decision: "block",
    reason: `强制休息中，还需要真实空闲 ${formatPreciseRemaining(remainingIdleMs)}。请离开电脑休息一下。`,
    state: stripUndefined(state),
  };
}

function formatPreciseRemaining(remainingMs) {
  const seconds = Math.max(1, Math.ceil(remainingMs / 1_000));
  if (seconds < 60) {
    return `${seconds} 秒`;
  }

  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (restSeconds === 0) {
    return `${minutes} 分钟`;
  }
  return `${minutes} 分 ${restSeconds} 秒`;
}

function stripUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

export async function readState(statePath) {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function writeState(statePath, state) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function getBreakStartedAtMs(state, config) {
  if (Number.isFinite(state.breakStartedAtMs)) {
    return state.breakStartedAtMs;
  }
  if (Number.isFinite(state.breakUntilMs)) {
    return state.breakUntilMs - config.breakDurationMs;
  }
  return undefined;
}

function getRemainingRestMs({ idleMs, state, config }) {
  const restAccumulatedMs = getRestAccumulatedMs({
    idleMs,
    state,
    config,
  });
  return Math.max(1, config.idleRestThresholdMs - restAccumulatedMs);
}

function getRestAccumulatedMs({ idleMs, state, config }) {
  const existing = state.restAccumulatedMs ?? 0;
  const lastCountedIdleMs = state.lastCountedIdleMs ?? 0;

  if (idleMs < config.minRestChunkMs) {
    return existing;
  }

  if (idleMs < lastCountedIdleMs) {
    return existing + idleMs;
  }

  return existing + Math.max(0, idleMs - lastCountedIdleMs);
}

function getLastCountedIdleMs({ idleMs, restAccumulatedMs, state, config }) {
  if (idleMs < config.minRestChunkMs) {
    return undefined;
  }

  if (restAccumulatedMs <= (state.restAccumulatedMs ?? 0)) {
    return state.lastCountedIdleMs;
  }

  return idleMs;
}

async function main() {
  const stdinText = await readStdin();
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME is required to locate break guard state");
  }

  const result = await runUserPromptSubmitHook({
    stdinText,
    statePath: `${home}/.claude/break-guard/state.json`,
    config: await loadConfig(`${home}/.claude/break-guard/config.json`),
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.exitCode;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}
