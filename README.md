# Claude Code Break Guard

Claude Code 强制休息工具。工作到设定时间后，通过 macOS `HIDIdleTime` 检测键盘、鼠标、触控板是否持续没有操作，确保你真正休息。

## 亮点

- **两种模式**：strict（强制阻止）和 gentle（只提醒不阻止）
- **真实休息检测**：只有电脑真的空闲时才计入休息
- **有效休息累计**：休息期间会累计有效空闲片段，每段空闲至少 `1` 分钟才计入累计
- **工作中提前休息**：如果你在工作时间内已经完整空闲够休息时间，下一轮工作会从这次休息结束后重新开始计算
- **Mac 通知提醒**：休息未完成时会弹出系统通知
- **紧急跳过**：输入 `BREAK_GUARD_EMERGENCY` 可以临时跳过当前休息约束

## 模式说明

### strict 模式（默认）

工作时间到后，Claude Code **不会继续回答**，直到你真正休息够了。

- 到时间后发消息会被阻止
- 必须真实空闲达标才能恢复
- 适合需要强制休息的场景

### gentle 模式

工作时间到后，Claude Code **会提醒你休息但不会阻止**。

- 到时间后发消息会收到提醒通知
- Claude Code 仍然正常回复
- 每条消息都会持续提醒
- 适合只需要提醒、不想被阻止的场景

## 快速开始

```bash
git clone https://github.com/yhurrima/claude-code-break-guard.git
cd claude-code-break-guard
node scripts/install.js
```

默认配置：工作 `25` 分钟，休息 `5` 分钟，strict 模式。

## 安装

```bash
node scripts/install.js --work <时间> --rest <时间> --mode <模式>
```

参数说明：

- `--work`：工作时长，如 `25m`、`1h`
- `--rest`：休息时长，如 `3m`、`5m`
- `--mode`：模式，`strict`（默认）或 `gentle`

示例：

```bash
# strict 模式，工作 25 分钟，休息 5 分钟
node scripts/install.js --work 25m --rest 5m

# gentle 模式，工作 30 分钟，休息 10 分钟
node scripts/install.js --work 30m --rest 10m --mode gentle
```

安装会自动：

- 备份并修改 `~/.claude/settings.json`
- 添加 Claude Code `UserPromptSubmit` hook
- 写入 `~/.claude/break-guard/config.json`
- 创建并启动 macOS LaunchAgent monitor

## 使用方式

### 修改时间或模式

重新运行安装脚本即可：

```bash
node scripts/install.js --work 30m --rest 5m --mode gentle
```

### 紧急跳过

如果确实有紧急情况，在 Claude Code 里单独发送：

```text
BREAK_GUARD_EMERGENCY
```

这会跳过当前这次休息，并从发送指令的时间点开始重新计算下一轮工作时间。

### 查看状态

```bash
cat ~/.claude/break-guard/state.json
cat ~/.claude/break-guard/config.json
```

### 卸载

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
Claude Code hook 检查模式
  |
  +-- strict --> 阻止回复，提示需要休息
  |
  +-- gentle --> 发送提醒通知，允许回复
  |
  v
检查是否已经累计足够有效休息
  |
  +-- 是 --> 放行并重新开始工作计时
  |
  +-- 否 --> 继续提醒/阻止
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

- Project: `2026-05-14-claude-code-break-guard`

This block is managed by `update-readme` and can be regenerated at any time.

<!-- AUTO-README-END -->
