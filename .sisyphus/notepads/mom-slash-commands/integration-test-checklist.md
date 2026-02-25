# mom Slash Commands 集成测试清单

> **测试环境要求**: 运行中的 mom Slack bot，至少两个测试频道

## 前置条件

1. 确保 mom 已构建并运行：`cd packages/mom && pnpm build && mom --sandbox=docker:mom-sandbox ./data`
2. 将 mom 添加到至少两个测试频道
3. 确保有多个可用的模型 API key

---

## 1. `/model` 命令测试

### 1.1 显示当前模型
```
@mom /model
```
- [ ] 返回当前模型信息（如 `Current model: anthropic/claude-sonnet-4-20250514`）
- [ ] 或返回 "No model selected" 如果没有模型

### 1.2 精确切换模型（完整格式）
```
@mom /model anthropic/claude-sonnet-4-20250514
```
- [ ] 返回 `Switched model to anthropic/claude-sonnet-4-20250514`
- [ ] 下一条消息使用新模型（检查日志确认）

### 1.3 精确切换模型（仅 modelId）
```
@mom /model claude-sonnet-4-20250514
```
- [ ] 返回 `Switched model to anthropic/claude-sonnet-4-20250514`
- [ ] 如果 modelId 不唯一，返回歧义错误

### 1.4 模型不存在
```
@mom /model nonexistent-model
```
- [ ] 返回 `No model found matching "nonexistent-model". Use "/model" to see available models.`
- [ ] 或返回候选列表（如果有模糊匹配）

### 1.5 模型持久化
```
# 步骤 1: 切换模型
@mom /model openai/gpt-4o

# 步骤 2: 重启 mom 进程

# 步骤 3: 检查模型
@mom /model
```
- [ ] 重启后模型仍然是 `openai/gpt-4o`

### 1.6 切换时正在流式响应
```
# 步骤 1: 发送一个会触发长响应的消息
@mom 请写一个 1000 字的故事

# 步骤 2: 在响应过程中切换模型
@mom /model anthropic/claude-sonnet-4-20250514
```
- [ ] 切换成功（当前响应继续，下一条消息使用新模型）

---

## 2. `/new` 命令测试

### 2.1 基本会话重置
```
# 步骤 1: 建立一些对话上下文
@mom 请记住我的名字是 Alice

# 步骤 2: 确认上下文建立
@mom 我叫什么名字？
# 期望: Alice

# 步骤 3: 执行 /new
@mom /new

# 步骤 4: 验证上下文已清空
@mom 我叫什么名字？
# 期望: 不知道/没有记录
```
- [ ] `/new` 返回 `New session started`
- [ ] 新会话不记得之前的对话

### 2.2 文件轮转归档验证
```
# 步骤 1: 在频道目录创建一些内容
# data/C123ABC/context.jsonl 和 log.jsonl 应该有内容

# 步骤 2: 执行 /new
@mom /new

# 步骤 3: 检查文件系统
ls data/C123ABC/archive/
```
- [ ] `archive/` 目录存在
- [ ] 包含带时间戳的 `context.*.jsonl` 和 `log.*.jsonl`
- [ ] 原位置的 `context.jsonl` 和 `log.jsonl` 是空文件或新内容

### 2.3 流式响应时执行 /new
```
# 步骤 1: 触发长响应
@mom 请写一个 2000 字的文章

# 步骤 2: 立即执行 /new（在响应过程中）
@mom /new
```
- [ ] 当前响应被中断
- [ ] 返回 `New session started`
- [ ] 会话已重置

### 2.4 /new 不接受参数
```
@mom /new extra-args
```
- [ ] 返回 `Usage: /new (no arguments)`

---

## 3. 多频道隔离测试

### 3.1 频道 A 的 /new 不影响频道 B
```
# 在频道 A
@mom 频道 A 的秘密代码是 ALPHA123
@mom /model anthropic/claude-sonnet-4-20250514

# 在频道 B
@mom 频道 B 的秘密代码是 BRAVO456

# 回到频道 A 执行 /new
@mom /new

# 在频道 A 验证
@mom 秘密代码是什么？
# 期望: 不知道

# 在频道 B 验证
@mom 秘密代码是什么？
# 期望: BRAVO456
```
- [ ] 频道 A 的 `/new` 不影响频道 B
- [ ] 频道 B 仍记得自己的上下文

### 3.2 模型切换隔离
```
# 在频道 A
@mom /model openai/gpt-4o

# 在频道 B
@mom /model anthropic/claude-sonnet-4-20250514

# 在频道 A 检查
@mom /model
# 期望: openai/gpt-4o

# 在频道 B 检查
@mom /model
# 期望: anthropic/claude-sonnet-4-20250514
```
- [ ] 每个频道维护独立的模型设置

---

## 4. 边界情况测试

### 4.1 空格处理
```
@mom /model   
@mom /new   
```
- [ ] `/model` 后面多个空格仍显示当前模型
- [ ] `/new` 后面多个空格仍执行重置

### 4.2 大小写
```
@mom /MODEL
@mom /Model
@mom /NEW
@mom /New
```
- [ ] 命令名大小写不敏感

### 4.3 无效命令
```
@mom /invalid-command
```
- [ ] 不被处理，作为普通消息发送给 agent

### 4.4 命令前有其他文本
```
@mom please /model
```
- [ ] 不被识别为命令，作为普通消息处理

---

## 5. 日志验证

### 5.1 检查 agent 日志
```bash
# 查看 mom 日志输出
# 应该看到类似：
# [agent] [C123ABC] Model changed to anthropic/claude-sonnet-4-20250514
# [agent] [C123ABC] Session reset, archived to 2026-02-25T10-30-45-123Z
```
- [ ] `/model` 切换有日志记录
- [ ] `/new` 重置有日志记录，包含时间戳

### 5.2 检查文件系统
```bash
# 验证 settings.json 更新
cat data/settings.json | grep -A2 defaultModel
```
- [ ] `/model` 切换后 settings.json 中的 defaultModel 和 defaultProvider 已更新

---

## 测试结果汇总

| 测试项 | 通过 | 失败 | 备注 |
|--------|------|------|------|
| 1.1 显示当前模型 | | | |
| 1.2 精确切换（完整格式） | | | |
| 1.3 精确切换（仅 modelId） | | | |
| 1.4 模型不存在 | | | |
| 1.5 模型持久化 | | | |
| 1.6 流式时切换 | | | |
| 2.1 基本会话重置 | | | |
| 2.2 文件轮转归档 | | | |
| 2.3 流式时 /new | | | |
| 2.4 /new 不接受参数 | | | |
| 3.1 多频道隔离 | | | |
| 3.2 模型切换隔离 | | | |
| 4.1 空格处理 | | | |
| 4.2 大小写 | | | |
| 4.3 无效命令 | | | |
| 4.4 命令前有文本 | | | |
| 5.1 日志验证 | | | |
| 5.2 文件系统验证 | | | |

---

## 测试完成签名

- **测试人员**: _______________
- **测试日期**: _______________
- **mom 版本**: _______________
- **总体结果**: [ ] 通过 [ ] 需修复

### 发现的问题

1. 
2. 
3. 
