# Claude Code Break Guard

Claude Code 强制休息工具。工作到设定时间后，Claude Code 会停止回答，直到 macOS 检测到你真的连续空闲了指定休息时间。

它不是简单倒计时，而是通过 macOS `HIDIdleTime` 检测键盘、鼠标、触控板是否持续没有操作。移动鼠标、点击、打字、触控板滚动都会打断休息计时；必须连续真实空闲满休息时间，才会恢复 Claude Code 对话。

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
