# Claude Code Break Guard

Claude Code 强制休息工具。工作到设定时间后，Claude Code 会停止回答，直到 macOS 检测到你真的连续空闲了指定休息时间。

它不是简单倒计时，而是通过 macOS `HIDIdleTime` 检测键盘、鼠标、触控板是否持续没有操作。移动鼠标、点击、打字、触控板滚动都会打断当前空闲片段。

休息期间会累计有效空闲片段；每段空闲至少 `1` 分钟才计入累计。比如休息要求是 `5` 分钟，已经有效空闲 `4` 分钟后回来问 Claude Code，它会提示还需要休息 `1` 分钟，而不是重新休息 `5` 分钟。

## 安装

```bash
git clone https://github.com/yhurrima/claude-code-break-guard.git
cd claude-code-break-guard
node scripts/install.js --work 25m --rest 5m
```

这会自动：

- 备份并修改 `~/.claude/settings.json`
- 添加 Claude Code `UserPromptSubmit` hook
- 写入 `~/.claude/break-guard/config.json`
- 创建并启动 macOS LaunchAgent monitor

## Skill 安装方式

告诉 Claude Code：

```text
帮我安装这个技能：https://github.com/yhurrima/claude-code-break-guard/tree/main/skills/claude-code-break-guard
```

## 修改时间

重新运行安装命令即可覆盖配置：

```bash
node scripts/install.js --work 50m --rest 10m
```

支持单位：`ms`、`s`、`m`、`h`。

## 紧急跳过

在 Claude Code 里输入：

```text
BREAK_GUARD_EMERGENCY
```

当前会跳过本次休息，重新开始工作计时，并临时关闭强制休息 `2` 分钟。

## 工作中提前休息

如果工作期间已经完整空闲满休息时长，也会视为已经休息过，并重置工作计时。

例如设置为工作 `30` 分钟、休息 `5` 分钟：如果你在第 `15` 到第 `20` 分钟真实空闲了 `5` 分钟，下一次强制休息会从第 `20` 分钟重新计算，而不是仍然在第 `30` 分钟触发。

## 查看状态

```bash
jq '.hooks.UserPromptSubmit' ~/.claude/settings.json
launchctl print gui/$(id -u)/com.yhurri.claude-code-break-guard.monitor
jq '.' ~/.claude/break-guard/state.json ~/.claude/break-guard/config.json
```

## 卸载

停用但保留配置：

```bash
node scripts/uninstall.js
```

彻底删除配置和状态：

```bash
node scripts/uninstall.js --remove-config
```

## 测试

```bash
npm test
```

## 依赖

- macOS
- Claude Code hooks
- Node.js `>=20`

## License

MIT

<!-- AUTO-README-START -->

## Auto-generated Project Map

- Project: `claude-code-break-guard`

This block is managed by `update-readme` and can be regenerated at any time.

<!-- AUTO-README-END -->
