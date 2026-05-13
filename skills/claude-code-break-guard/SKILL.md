---
name: claude-code-break-guard
description: Install, configure, pause, resume, uninstall, and troubleshoot Claude Code Break Guard, a macOS Claude Code hook that enforces real idle breaks with a background monitor. Use when the user asks to set up forced breaks, change work/rest time, disable or uninstall the guard, check break status, or handle emergency skip behavior for Claude Code.
---

# Claude Code Break Guard

Use this skill to manage Claude Code Break Guard through natural language while relying on the project scripts for system changes.

## Defaults

- Default work duration: `25m`
- Default required real rest duration: `5m`
- Effective rest chunks must be at least `1m` before they count toward accumulated break rest.
- Do not ask normal users about `monitorIntervalMs`; it is an implementation detail.
- Emergency skip command: `BREAK_GUARD_EMERGENCY`

## Project Path

Prefer the current working directory if it contains:

- `src/break-guard.js`
- `src/break-monitor.js`
- `scripts/install.js`
- `scripts/uninstall.js`

If not, ask the user for the local project path before installing or changing configuration.

## First-Time Install

When the user asks to install or set up the guard:

1. Ask for work and rest durations in natural language.

   Use this concise prompt:

   `你希望工作多久后强制休息？默认 25 分钟。你希望真实休息多久后恢复？默认 5 分钟。`

2. Parse answers like `25 分钟休息 5 分钟`, `work 45m rest 10m`, or `默认`.

3. Convert to CLI durations:

   - `25 分钟` -> `25m`
   - `5 分钟` -> `5m`
   - `1 小时` -> `1h`

4. Run:

   ```bash
   node scripts/install.js --work <work> --rest <rest>
   ```

5. Verify:

   ```bash
   jq '.hooks.UserPromptSubmit' ~/.claude/settings.json
   launchctl print gui/$(id -u)/com.yhurri.claude-code-break-guard.monitor
   jq '.' ~/.claude/break-guard/config.json
   ```

6. Tell the user:

   - The configured work/rest durations.
   - Whether the monitor is running.
   - The emergency skip command: `BREAK_GUARD_EMERGENCY`.

## Change Work Or Rest Time

When the user asks to change time settings:

1. Extract the new work/rest durations from the user's natural language.
2. If either value is missing, ask only for the missing value.
3. Run:

   ```bash
   node scripts/install.js --work <work> --rest <rest>
   ```

4. Verify `~/.claude/break-guard/config.json`.

## Emergency Skip

Tell users they can type this exact prompt in Claude Code:

```text
BREAK_GUARD_EMERGENCY
```

Current project behavior:

- It skips the current break.
- It resets the work timer from the moment the command is submitted.
- It immediately starts the next work cycle.
- It returns and notifies: `已开启紧急跳过，已重新开始下一轮工作计时。`

Do not expose code commands for emergency skip unless the user explicitly asks for a terminal-only workaround.

## Pause Or Uninstall

For a temporary pause, prefer uninstalling without removing config:

```bash
node scripts/uninstall.js
```

For full removal of hook, monitor, config, and state:

```bash
node scripts/uninstall.js --remove-config
```

After uninstalling, verify:

```bash
jq '.hooks.UserPromptSubmit // "no UserPromptSubmit hook"' ~/.claude/settings.json
launchctl print gui/$(id -u)/com.yhurri.claude-code-break-guard.monitor
```

## Status And Troubleshooting

Use these checks:

```bash
jq '.' ~/.claude/break-guard/state.json ~/.claude/break-guard/config.json
launchctl print gui/$(id -u)/com.yhurri.claude-code-break-guard.monitor
ioreg -c IOHIDSystem | rg HIDIdleTime
```

Key state fields:

- `workStartedAtMs`: current work cycle start.
- `breakStartedAtMs`: current forced break start.
- `restCompletedAtMs`: monitor confirmed a real idle rest after break start.
- `restAccumulatedMs`: accumulated valid idle rest during the current break.

If a prompt is blocked after the user says they rested, check whether `restCompletedAtMs >= breakStartedAtMs`. If not, explain that the monitor did not observe enough continuous macOS idle time.

Rest semantics:

- During an active break, effective idle chunks are accumulated.
- Idle chunks shorter than `minRestChunkMs` do not count.
- Default `minRestChunkMs` is `1m`.
- During work time, a full idle rest equal to `idleRestThresholdMs` resets the work timer.

## Safety

- Always preserve unrelated hooks in `~/.claude/settings.json`.
- Ensure settings are backed up before install or uninstall; the project scripts do this.
- Do not manually edit `settings.json` unless the scripts fail and the user approves.
- Do not remove `Stop`, `PermissionRequest`, or other unrelated hooks.
