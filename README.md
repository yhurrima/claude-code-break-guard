# Claude Code Break Guard

Claude Code 强制休息工具。工作到设定时间后，Claude Code 会停止回答，直到 macOS 检测到你真的休息够了。

它不是简单倒计时，而是通过 macOS `HIDIdleTime` 检测键盘、鼠标、触控板是否持续没有操作。移动鼠标、点击、打字、触控板滚动都会打断当前空闲片段。

## 亮点

- **真实休息检测**：只有电脑真的空闲时才计入休息。
- **有效休息累计**：休息期间会累计有效空闲片段，每段空闲至少 `1` 分钟才计入累计。
- **工作中提前休息**：如果你在工作时间内已经完整空闲够休息时间，下一轮工作会从这次休息结束后重新开始计算。
- **Claude Code 强制拦截**：休息未完成时，Claude Code 不会继续回答。
- **Mac 通知提醒**：休息未完成时会弹出系统通知。
- **紧急跳过**：输入 `BREAK_GUARD_EMERGENCY` 可以临时跳过当前休息约束。

## 快速开始

```bash
git clone https://github.com/yhurrima/claude-code-break-guard.git
cd claude-code-break-guard
node scripts/install.js
```

默认配置是工作 `25` 分钟，休息 `5` 分钟。

## 安装

### 方式 1：手动安装

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

### 方式 2：让 Claude Code 安装

告诉 Claude Code：

```text
帮我安装这个技能：https://github.com/yhurrima/claude-code-break-guard/tree/main/skills/claude-code-break-guard
```

安装技能后，可以继续用自然语言让 Claude Code 帮你安装、修改工作时间、修改休息时间、暂停、恢复或卸载。

## 使用方式

1. 修改时间

重新运行安装脚本即可修改工作和休息时间：

```bash
node scripts/install.js --work 30m --rest 5m
```

时间支持：

- `30s`
- `25m`
- `1h`

2. 紧急跳过

如果确实有紧急情况，在 Claude Code 里单独发送：

```text
BREAK_GUARD_EMERGENCY
```

这会跳过当前这次休息，并从发送指令的时间点开始重新计算下一轮工作时间。

3. 查看状态

```bash
cat ~/.claude/break-guard/state.json
```

4. 卸载

```bash
node scripts/uninstall.js
```

如果要同时删除配置和状态：

```bash
node scripts/uninstall.js --remove-config
```

## 工作流程

```text
开始工作
  |
  v
后台 monitor 持续检测电脑空闲时间
  |
  v
达到工作时长
  |
  v
Claude Code hook 拦截新 prompt
  |
  v
检查是否已经累计足够有效休息
  |
  +-- 是 --> 放行并重新开始工作计时
  |
  +-- 否 --> 阻止回复，并提示还需要休息多久
```

## 前置依赖

- macOS
- Node.js `20` 或更高版本
- Claude Code

## 测试

```bash
npm test
```

## License

MIT

<!-- AUTO-README-START -->

## Auto-generated Project Map

- Project: `claude-code-break-guard`

This block is managed by `update-readme` and can be regenerated at any time.

<!-- AUTO-README-END -->
