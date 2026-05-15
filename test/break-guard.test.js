import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  decidePrompt,
  formatRemaining,
  loadConfig,
  parseMacIdleMs,
  runUserPromptSubmitHook,
} from "../src/break-guard.js";
import { runMonitorTick } from "../src/break-monitor.js";

const MINUTE = 60 * 1000;
const EMERGENCY_PROMPT = "BREAK_GUARD_EMERGENCY";

test("first prompt starts the global work timer and allows the prompt", () => {
  const result = decidePrompt({
    nowMs: 1_000,
    idleMs: 0,
    state: {},
  });

  assert.equal(result.decision, "allow");
  assert.equal(result.state.workStartedAtMs, 1_000);
});

test("prompt before the work limit is allowed", () => {
  const result = decidePrompt({
    nowMs: 30 * 1000,
    idleMs: 0,
    state: { workStartedAtMs: 0 },
  });

  assert.equal(result.decision, "allow");
  assert.equal(result.state.workStartedAtMs, 0);
});

test("prompt after the work limit starts a break and blocks the prompt", () => {
  const result = decidePrompt({
    nowMs: 25 * MINUTE + 1,
    idleMs: 60 * 1000,
    state: { workStartedAtMs: 0 },
  });

  assert.equal(result.decision, "block");
  assert.equal(result.state.breakUntilMs, 30 * MINUTE + 1);
  assert.match(result.reason, /强制休息中/);
});

test("prompt during an active break stays blocked with required idle time", () => {
  const result = decidePrompt({
    nowMs: 26 * MINUTE,
    idleMs: 0,
    state: {
      workStartedAtMs: 0,
      breakUntilMs: 30 * MINUTE,
    },
  });

  assert.equal(result.decision, "block");
  assert.match(result.reason, /还需要真实空闲 5 分钟/);
});

test("enough system idle time counts as rest and resets the work timer", () => {
  const result = decidePrompt({
    nowMs: 26 * MINUTE,
    idleMs: 5 * MINUTE,
    state: { workStartedAtMs: 0 },
  });

  assert.equal(result.decision, "allow");
  assert.equal(result.state.workStartedAtMs, 26 * MINUTE);
  assert.equal(result.state.breakUntilMs, undefined);
});

test("expired break still blocks when system idle time is too short", () => {
  const result = decidePrompt({
    nowMs: 29 * MINUTE,
    idleMs: 0,
    state: {
      workStartedAtMs: 0,
      breakStartedAtMs: 25 * MINUTE,
      breakUntilMs: 28 * MINUTE,
    },
  });

  assert.equal(result.decision, "block");
  assert.equal(result.state.workStartedAtMs, 0);
  assert.equal(result.state.breakUntilMs, 28 * MINUTE);
  assert.match(result.reason, /强制休息中/);
});

test("active break allows only after enough real system idle time", () => {
  const result = decidePrompt({
    nowMs: 29 * MINUTE,
    idleMs: 5 * MINUTE,
    state: {
      workStartedAtMs: 0,
      breakStartedAtMs: 25 * MINUTE,
      breakUntilMs: 28 * MINUTE,
    },
  });

  assert.equal(result.decision, "allow");
  assert.equal(result.state.workStartedAtMs, 29 * MINUTE);
  assert.equal(result.state.breakStartedAtMs, undefined);
  assert.equal(result.state.breakUntilMs, undefined);
});

test("recorded rest completion allows the next prompt even when typing resets idle", () => {
  const result = decidePrompt({
    nowMs: 29 * MINUTE,
    idleMs: 0,
    state: {
      workStartedAtMs: 0,
      breakStartedAtMs: 25 * MINUTE,
      breakUntilMs: 28 * MINUTE,
      restCompletedAtMs: 27 * MINUTE,
    },
  });

  assert.equal(result.decision, "allow");
  assert.equal(result.state.workStartedAtMs, 29 * MINUTE);
  assert.equal(result.state.breakStartedAtMs, undefined);
  assert.equal(result.state.breakUntilMs, undefined);
  assert.equal(result.state.restCompletedAtMs, undefined);
});

test("stale rest completion before the current break does not allow the prompt", () => {
  const result = decidePrompt({
    nowMs: 29 * MINUTE,
    idleMs: 0,
    state: {
      workStartedAtMs: 0,
      breakStartedAtMs: 25 * MINUTE,
      breakUntilMs: 28 * MINUTE,
      restCompletedAtMs: 24 * MINUTE,
    },
  });

  assert.equal(result.decision, "block");
  assert.equal(result.state.restCompletedAtMs, 24 * MINUTE);
});

test("runMonitorTick records completed rest during an active break", async () => {
  const dir = await mkdtemp(join(tmpdir(), "break-guard-monitor-"));
  const statePath = join(dir, "state.json");
  const configPath = join(dir, "config.json");

  try {
    await writeFile(
      statePath,
      `${JSON.stringify({
        workStartedAtMs: 0,
        breakStartedAtMs: 1 * MINUTE,
        breakUntilMs: 6 * MINUTE,
      })}\n`,
    );
    await writeFile(
      configPath,
      `${JSON.stringify({
        idleRestThresholdMs: MINUTE,
      })}\n`,
    );

    const result = await runMonitorTick({
      statePath,
      configPath,
      nowMs: 5 * MINUTE,
      getIdleMs: () => MINUTE,
    });

    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(result.recorded, true);
    assert.equal(state.restCompletedAtMs, 5 * MINUTE);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("monitor resets work timer when full rest happens during work time", async () => {
  const dir = await mkdtemp(join(tmpdir(), "break-guard-monitor-"));
  const statePath = join(dir, "state.json");
  const configPath = join(dir, "config.json");

  try {
    await writeFile(
      statePath,
      `${JSON.stringify({
        workStartedAtMs: 0,
      })}\n`,
    );
    await writeFile(
      configPath,
      `${JSON.stringify({
        workDurationMs: 1 * MINUTE,
        breakDurationMs: 5 * MINUTE,
        idleRestThresholdMs: 5 * MINUTE,
      })}\n`,
    );

    const result = await runMonitorTick({
      statePath,
      configPath,
      nowMs: 30 * 1000,
      getIdleMs: () => 5 * MINUTE,
    });

    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(result.recorded, true);
    assert.equal(state.workStartedAtMs, 30 * 1000);
    assert.equal(state.breakStartedAtMs, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("monitor accumulates only rest chunks of at least one minute during break", async () => {
  const dir = await mkdtemp(join(tmpdir(), "break-guard-monitor-"));
  const statePath = join(dir, "state.json");
  const configPath = join(dir, "config.json");

  try {
    await writeFile(
      statePath,
      `${JSON.stringify({
        workStartedAtMs: 0,
        breakStartedAtMs: 1 * MINUTE,
        breakUntilMs: 6 * MINUTE,
      })}\n`,
    );
    await writeFile(
      configPath,
      `${JSON.stringify({
        idleRestThresholdMs: 5 * MINUTE,
      })}\n`,
    );

    await runMonitorTick({
      statePath,
      configPath,
      nowMs: 2 * MINUTE,
      getIdleMs: () => 30 * 1000,
    });
    let state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(state.restAccumulatedMs, undefined);

    await runMonitorTick({
      statePath,
      configPath,
      nowMs: 5 * MINUTE,
      getIdleMs: () => 4 * MINUTE,
    });
    state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(state.restAccumulatedMs, 4 * MINUTE);
    assert.equal(state.restCompletedAtMs, undefined);

    const blocked = decidePrompt({
      nowMs: 5 * MINUTE + 10 * 1000,
      idleMs: 0,
      state,
      config: {
        workDurationMs: 1 * MINUTE,
        breakDurationMs: 5 * MINUTE,
        idleRestThresholdMs: 5 * MINUTE,
      },
    });
    assert.equal(blocked.decision, "block");
    assert.match(blocked.reason, /还需要真实空闲 1 分钟/);

    await writeFile(statePath, `${JSON.stringify(blocked.state, null, 2)}\n`);
    await runMonitorTick({
      statePath,
      configPath,
      nowMs: 6 * MINUTE + 10 * 1000,
      getIdleMs: () => MINUTE,
    });
    state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(state.restAccumulatedMs, 5 * MINUTE);
    assert.equal(state.restCompletedAtMs, 6 * MINUTE + 10 * 1000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("emergency command skips the current break and starts a fresh work cycle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "break-guard-"));
  const statePath = join(dir, "state.json");
  const notifications = [];

  try {
    await writeFile(
      statePath,
      `${JSON.stringify({
        workStartedAtMs: 0,
        breakStartedAtMs: 1 * MINUTE,
        breakUntilMs: 6 * MINUTE,
      })}\n`,
    );

    const result = await runUserPromptSubmitHook({
      stdinText: JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        prompt: EMERGENCY_PROMPT,
      }),
      statePath,
      nowMs: 2 * MINUTE,
      getIdleMs: () => 0,
      notifyUser: (message) => notifications.push(message),
    });

    const state = JSON.parse(await readFile(statePath, "utf8"));
    const output = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(output.decision, "block");
    assert.match(output.reason, /已开启紧急跳过/);
    assert.equal(result.stderr, "");
    assert.deepEqual(notifications, ["已开启紧急跳过，已重新开始下一轮工作计时。"]);
    assert.equal(state.workStartedAtMs, 2 * MINUTE);
    assert.equal(state.breakStartedAtMs, undefined);
    assert.equal(state.breakUntilMs, undefined);
    assert.equal(state.restCompletedAtMs, undefined);
    assert.equal(state.skipBreakUntilMs, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("formatRemaining rounds up partial minutes", () => {
  assert.equal(formatRemaining(1), "1 分钟");
  assert.equal(formatRemaining(61 * 1000), "2 分钟");
});

test("active break message is based on required idle time instead of stale break window", () => {
  const result = decidePrompt({
    nowMs: 36 * MINUTE,
    idleMs: 30 * 1000,
    state: {
      workStartedAtMs: 0,
      breakStartedAtMs: 30 * MINUTE,
      breakUntilMs: 31 * MINUTE,
    },
    config: {
      workDurationMs: 30 * MINUTE,
      breakDurationMs: MINUTE,
      idleRestThresholdMs: MINUTE,
    },
  });

  assert.equal(result.decision, "block");
  assert.match(result.reason, /还需要真实空闲 1 分钟/);
});

test("parseMacIdleMs parses HIDIdleTime nanoseconds from ioreg output", () => {
  const output = `
    | |   "HIDIdleTime" = 123456789000
  `;

  assert.equal(parseMacIdleMs(output), 123_456);
});

test("runUserPromptSubmitHook writes state and emits no stdout when allowed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "break-guard-"));
  const statePath = join(dir, "state.json");

  try {
    const result = await runUserPromptSubmitHook({
      stdinText: JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        prompt: "hello",
      }),
      statePath,
      nowMs: 1_000,
      getIdleMs: () => 0,
    });

    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.equal(state.workStartedAtMs, 1_000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runUserPromptSubmitHook blocks with visible stderr, notifies, and persists break state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "break-guard-"));
  const statePath = join(dir, "state.json");
  const notifications = [];

  try {
    await runUserPromptSubmitHook({
      stdinText: JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        prompt: "first",
      }),
      statePath,
      nowMs: 0,
      getIdleMs: () => 0,
    });

    const result = await runUserPromptSubmitHook({
      stdinText: JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        prompt: "after 25 minutes",
      }),
      statePath,
      nowMs: 25 * MINUTE + 1,
      getIdleMs: () => 0,
      notifyUser: (message) => notifications.push(message),
    });

    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /强制休息中/);
    assert.deepEqual(notifications, [
      "强制休息中，还剩 5 分钟。请离开电脑休息一下。",
    ]);
    assert.equal(state.breakUntilMs, 30 * MINUTE + 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig merges config file values with defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "break-guard-"));
  const configPath = join(dir, "config.json");

  try {
    await writeFile(
      configPath,
      JSON.stringify({
        workDurationMs: 3_000,
        breakDurationMs: 2_000,
      }),
    );

    const config = await loadConfig(configPath);
    assert.equal(config.workDurationMs, 3_000);
    assert.equal(config.breakDurationMs, 2_000);
    assert.equal(config.idleRestThresholdMs, 5 * MINUTE);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
