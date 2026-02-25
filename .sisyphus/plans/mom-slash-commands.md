# Mom Slash Commands 迁移计划

## TL;DR

> **目标**: 将 coding-agent TUI 的命令体系迁移到 mom Slack 运行时，第一批落地 `/model` 和 `/new`
>
> **方案**: 在 `core` 层引入统一的 builtin command 分发机制（`tryBuiltinCommand`），让 coding-agent 和 mom 共用同一套命令匹配/执行逻辑
>
> **工作量**: Medium (2-3 天)
> **并行执行**: NO - 有明确的依赖顺序
> **关键路径**: 抽象 core 命令分发器 → 重构 TUI 使用分发器 → mom 集成分发器

---

## 1. 背景与目标

### 1.1 当前状态

**coding-agent (TUI)**
- 命令匹配在 `interactive-mode.ts` 的 `onSubmit` 里硬编码
- `/model`、`/new` 等内建命令与 extension command 混在一起
- 命令执行逻辑散落在 UI 层

**mom (Slack)**
- 只有 `stop` 命令硬编码在 `slack.ts`
- 没有命令分发机制
- 需要复用 coding-agent 的命令语义

### 1.2 目标

1. **统一命令分发**: 在 `core` 层建立可复用的 builtin command 分发机制
2. **语义对齐**: `/model` 和 `/new` 在 mom 中的行为与 coding-agent 一致
3. **可扩展性**: 后续迁移其他命令（`/settings`、`/compact` 等）成本低

### 1.3 非目标

- 本计划不迁移全部 TUI 命令
- 不在 Slack 里实现复杂的 Block Kit 选择器 UI
- 不改动 coding-agent 的核心行为

---

## 2. 技术设计

### 2.1 核心抽象: Builtin Command Dispatcher

#### 2.1.1 命令解析 (纯函数)

**位置**: `packages/coding-agent/src/core/command-parser.ts` (新建)

```typescript
/**
 * 解析斜杠命令
 * @returns {name, args} 或 null（不是命令）
 */
export function parseSlashCommand(text: string): { name: string; args: string } | null {
  if (!text.startsWith("/")) return null;
  
  const trimmed = text.trim();
  const spaceIndex = trimmed.indexOf(" ");
  
  const name = spaceIndex === -1 
    ? trimmed.slice(1) 
    : trimmed.slice(1, spaceIndex);
  const args = spaceIndex === -1 
    ? "" 
    : trimmed.slice(spaceIndex + 1);
  
  return { name, args };
}

/**
 * 检查是否是内建命令
 */
export function isBuiltinCommand(name: string): boolean {
  return BUILTIN_SLASH_COMMANDS.some(cmd => cmd.name === name);
}
```

#### 2.1.2 命令执行器接口

**位置**: `packages/coding-agent/src/core/command-dispatcher.ts` (新建)

```typescript
/**
 * 内建命令执行器的运行时能力
 * 不依赖具体 UI/传输层，通过注入能力实现复用
 */
export interface BuiltinCommandRuntime {
  // 模型相关
  modelRegistry: ModelRegistry;
  currentModel: Model<any> | undefined;
  setModel(model: Model<any>): Promise<void>;
  
  // 会话相关
  newSession(): Promise<boolean>;
  isStreaming: boolean;
  abort(): Promise<void>;
  
  // 反馈相关（TUI 用状态栏，Slack 用回复消息）
  showStatus(message: string): void;
  showError(message: string): void;
  showModelSelector?(initialSearch?: string): void; // TUI 可选
}

/**
 * 内建命令执行结果
 */
export interface BuiltinCommandResult {
  handled: boolean;      // 是否被处理
  success?: boolean;     // 执行是否成功
  message?: string;      // 给用户的反馈
  error?: string;        // 错误信息
}

/**
 * 尝试执行内建命令
 * @returns 命令是否被处理
 */
export async function tryBuiltinCommand(
  name: string,
  args: string,
  runtime: BuiltinCommandRuntime
): Promise<BuiltinCommandResult> {
  // 分发到具体命令处理器
  switch (name) {
    case "model":
      return handleModelCommand(args, runtime);
    case "new":
      return handleNewCommand(args, runtime);
    // 后续扩展其他命令...
    default:
      return { handled: false };
  }
}
```

#### 2.1.3 `/model` 命令处理器

```typescript
async function handleModelCommand(
  args: string,
  runtime: BuiltinCommandRuntime
): Promise<BuiltinCommandResult> {
  const searchTerm = args.trim();
  
  // 无参数: 显示当前模型和用法
  if (!searchTerm) {
    const current = runtime.currentModel;
    const available = runtime.modelRegistry.getAvailable();
    
    return {
      handled: true,
      success: true,
      message: formatModelStatus(current, available),
    };
  }
  
  // 有参数: 尝试精确匹配
  const model = await findExactModelMatch(searchTerm, runtime.modelRegistry);
  
  if (!model) {
    const candidates = findModelCandidates(searchTerm, runtime.modelRegistry);
    return {
      handled: true,
      success: false,
      message: formatModelNotFound(searchTerm, candidates),
    };
  }
  
  // 匹配到: 切换模型
  try {
    await runtime.setModel(model);
    return {
      handled: true,
      success: true,
      message: `Switched model to ${model.provider}/${model.id}`,
    };
  } catch (err) {
    return {
      handled: true,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
```

#### 2.1.4 `/new` 命令处理器

```typescript
async function handleNewCommand(
  args: string,
  runtime: BuiltinCommandRuntime
): Promise<BuiltinCommandResult> {
  // /new 不接受参数
  if (args.trim()) {
    return {
      handled: true,
      success: false,
      message: "Usage: /new (no arguments)",
    };
  }
  
  // 如果正在流式输出，先中断
  if (runtime.isStreaming) {
    await runtime.abort();
  }
  
  try {
    const success = await runtime.newSession();
    if (success) {
      return {
        handled: true,
        success: true,
        message: "New session started",
      };
    } else {
      return {
        handled: true,
        success: false,
        message: "New session cancelled by extension",
      };
    }
  } catch (err) {
    return {
      handled: true,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
```

### 2.2 重构 coding-agent TUI

#### 2.2.1 实现 BuiltinCommandRuntime

**位置**: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`

在 `InteractiveMode` 类中实现 `BuiltinCommandRuntime` 接口：

```typescript
class InteractiveMode implements BuiltinCommandRuntime {
  // 已有的属性
  get modelRegistry() { return this.session.modelRegistry; }
  get currentModel() { return this.session.model; }
  get isStreaming() { return this.session.isStreaming; }
  
  // 实现接口方法
  async setModel(model: Model<any>): Promise<void> {
    await this.session.setModel(model);
    this.footer.invalidate();
    this.updateEditorBorderColor();
  }
  
  async newSession(): Promise<boolean> {
    return this.session.newSession();
  }
  
  async abort(): Promise<void> {
    await this.session.abort();
  }
  
  showStatus(message: string): void {
    this.showStatus(message); // 已有方法
  }
  
  showError(message: string): void {
    this.showError(message); // 已有方法
  }
  
  showModelSelector(initialSearch?: string): void {
    this.showModelSelector(initialSearch); // 已有方法
  }
}
```

#### 2.2.2 重构 onSubmit 处理

**Before** (当前硬编码):
```typescript
if (text === "/model" || text.startsWith("/model ")) {
  const searchTerm = text.startsWith("/model ") ? text.slice(7).trim() : undefined;
  await this.handleModelCommand(searchTerm);
  return;
}
if (text === "/new") {
  await this.handleClearCommand();
  return;
}
```

**After** (使用分发器):
```typescript
const parsed = parseSlashCommand(text);
if (parsed && isBuiltinCommand(parsed.name)) {
  const result = await tryBuiltinCommand(parsed.name, parsed.args, this);
  if (result.handled) {
    if (result.message) {
      result.success ? this.showStatus(result.message) : this.showError(result.message);
    }
    if (result.error) {
      this.showError(result.error);
    }
    this.editor.setText("");
    return;
  }
}
```

### 2.3 mom 集成

#### 2.3.1 命令入口

**位置**: `packages/mom/src/slack.ts`

在现有的 `stop` 命令检查之后，添加 builtin command 分发：

```typescript
// 现有的 stop 检查 (保持不变)
if (slackEvent.text.toLowerCase().trim() === "stop") {
  // ... existing stop logic
}

// 新增: builtin command 分发
const parsed = parseSlashCommand(slackEvent.text);
if (parsed && isBuiltinCommand(parsed.name)) {
  // 命令通过队列串行执行，避免竞态
  this.getQueue(e.channel).enqueue(async () => {
    const runner = getOrCreateRunner(sandbox, e.channel, channelDir);
    const result = await tryBuiltinCommand(parsed.name, parsed.args, runner);
    
    if (result.message) {
      await slack.postMessage(e.channel, result.message);
    }
    if (result.error) {
      await slack.postMessage(e.channel, `Error: ${result.error}`);
    }
  });
  ack();
  return;
}
```

#### 2.3.2 AgentRunner 实现 BuiltinCommandRuntime

**位置**: `packages/mom/src/agent.ts`

```typescript
export class AgentRunner implements BuiltinCommandRuntime {
  // 已有属性
  get modelRegistry() { return this._modelRegistry; }
  get currentModel() { return this.agent.model; }
  get isStreaming() { return this.agent.isRunning; }
  
  async setModel(model: Model<any>): Promise<void> {
    // 复用 AgentSession.setModel 的逻辑
    const apiKey = await this._modelRegistry.getApiKey(model);
    if (!apiKey) {
      throw new Error(`No API key for ${model.provider}/${model.id}`);
    }
    
    this.agent.setModel(model);
    this._sessionManager.appendModelChange(model.provider, model.id);
    this._settingsManager.setDefaultModelAndProvider(model.provider, model.id);
    
    // 记录日志
    agentLog.info(`[${this._channelId}] Model changed to ${model.provider}/${model.id}`);
  }
  
  async newSession(): Promise<boolean> {
    // mom 特有: 文件轮转重置
    return this._resetSession();
  }
  
  async abort(): Promise<void> {
    this.agent.abort();
    await this.agent.waitForIdle();
  }
  
  showStatus(message: string): void {
    // Slack 模式下，status 通过返回消息体现
    // 这个方法在 mom 里可以忽略或记录日志
    agentLog.info(`[${this._channelId}] Status: ${message}`);
  }
  
  showError(message: string): void {
    agentLog.error(`[${this._channelId}] Error: ${message}`);
  }
  
  // mom 特有方法
  private async _resetSession(): Promise<boolean> {
    // 1. 中断当前运行
    await this.abort();
    
    // 2. 轮转归档文件
    const channelDir = this._channelDir;
    const contextFile = join(channelDir, "context.jsonl");
    const logFile = join(channelDir, "log.jsonl");
    const archiveDir = join(channelDir, "archive");
    
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    
    // 归档旧文件
    if (existsSync(contextFile)) {
      renameSync(contextFile, join(archiveDir, `context.${timestamp}.jsonl`));
    }
    if (existsSync(logFile)) {
      renameSync(logFile, join(archiveDir, `log.${timestamp}.jsonl`));
    }
    
    // 3. 创建新的空文件
    writeFileSync(contextFile, "");
    writeFileSync(logFile, "");
    
    // 4. 重建 session manager
    this._sessionManager = SessionManager.open(contextFile, channelDir);
    
    // 5. 清理 replay 状态
    // (syncLogToSessionManager 会从新的空 log.jsonl 开始)
    
    agentLog.info(`[${this._channelId}] Session reset, archived to ${timestamp}`);
    return true;
  }
}
```

### 2.4 模型匹配逻辑复用

#### 2.4.1 提取到 core 层

**位置**: `packages/coding-agent/src/core/model-matcher.ts` (新建)

```typescript
/**
 * 精确匹配模型
 * 支持 "provider/modelId" 或仅 "modelId" 格式
 */
export async function findExactModelMatch(
  searchTerm: string,
  modelRegistry: ModelRegistry
): Promise<Model<any> | undefined> {
  const term = searchTerm.trim().toLowerCase();
  if (!term) return undefined;
  
  let targetProvider: string | undefined;
  let targetModelId: string;
  
  if (term.includes("/")) {
    const parts = term.split("/", 2);
    targetProvider = parts[0]?.trim();
    targetModelId = parts[1]?.trim() ?? "";
  } else {
    targetModelId = term;
  }
  
  if (!targetModelId) return undefined;
  
  const models = modelRegistry.getAvailable();
  const exactMatches = models.filter((model) => {
    const idMatch = model.id.toLowerCase() === targetModelId;
    const providerMatch = !targetProvider || 
      model.provider.toLowerCase() === targetProvider;
    return idMatch && providerMatch;
  });
  
  return exactMatches.length === 1 ? exactMatches[0] : undefined;
}

/**
 * 查找候选模型（用于错误提示）
 */
export function findModelCandidates(
  searchTerm: string,
  modelRegistry: ModelRegistry,
  limit: number = 5
): Model<any>[] {
  const term = searchTerm.trim().toLowerCase();
  const models = modelRegistry.getAvailable();
  
  // 模糊匹配: modelId 或 provider 包含搜索词
  return models
    .filter(m => 
      m.id.toLowerCase().includes(term) ||
      m.provider.toLowerCase().includes(term)
    )
    .slice(0, limit);
}
```

---

## 3. 实现步骤

### Wave 1: Core 层抽象 (Day 1)

| 任务 | 文件 | 说明 |
|------|------|------|
| 1.1 | `core/command-parser.ts` | 命令解析纯函数 |
| 1.2 | `core/model-matcher.ts` | 模型匹配逻辑 |
| 1.3 | `core/command-dispatcher.ts` | 命令分发器接口和实现 |
| 1.4 | `core/index.ts` | 导出新模块 |

**依赖**: 无  
**并行**: 可以全部并行

### Wave 2: 重构 TUI (Day 1-2)

| 任务 | 文件 | 说明 |
|------|------|------|
| 2.1 | `interactive-mode.ts` | 实现 `BuiltinCommandRuntime` 接口 |
| 2.2 | `interactive-mode.ts` | 重构 `onSubmit` 使用分发器 |
| 2.3 | `interactive-mode.ts` | 删除旧的 `handleModelCommand` 等方法 |
| 2.4 | `agent-session.ts` | 确保 `setModel`/`newSession` 可被外部调用 |

**依赖**: Wave 1 完成  
**验证**: TUI 所有现有命令行为不变

### Wave 3: mom 集成 (Day 2-3)

| 任务 | 文件 | 说明 |
|------|------|------|
| 3.1 | `agent.ts` | `AgentRunner` 实现 `BuiltinCommandRuntime` |
| 3.2 | `agent.ts` | 添加 `_resetSession()` 方法（文件轮转） |
| 3.3 | `slack.ts` | 添加 builtin command 分发逻辑 |
| 3.4 | `main.ts` | 确保 `MomHandler` 支持命令队列 |

**依赖**: Wave 1 完成  
**验证**: `/model` 和 `/new` 在 Slack 中可用

### Wave 4: 测试与文档 (Day 3)

| 任务 | 文件 | 说明 |
|------|------|------|
| 4.1 | `core/*.test.ts` | 单元测试：解析、匹配、分发 |
| 4.2 | `mom/test/*.test.ts` | 集成测试：Slack 命令流程 |
| 4.3 | `mom/README.md` | 更新文档：可用命令列表 |

---

## 4. 命令语义详解

### 4.1 `/model` 命令

#### 语法
```
/model                      # 显示当前模型和用法
/model <pattern>            # 切换模型
```

#### pattern 匹配规则
1. **精确匹配优先**: `provider/modelId` 或仅 `modelId`
2. **唯一性要求**: 
   - 仅 `modelId` 时必须全局唯一
   - 不唯一则返回歧义错误
3. **大小写不敏感**: 匹配时忽略大小写

#### 状态变更
| 变更 | 作用域 | 持久化 |
|------|--------|--------|
| `agent.setModel(model)` | 内存 | 会话内 |
| `sessionManager.appendModelChange()` | 会话 | `context.jsonl` |
| `settingsManager.setDefaultModelAndProvider()` | 设置 | `settings.json` |

#### mom 特有
- 成功后立即生效（下一条消息使用新模型）
- 无需重启进程或重建 runner

### 4.2 `/new` 命令

#### 语法
```
/new                        # 开始新会话（无参数）
```

#### coding-agent 行为
- 创建新 session 文件
- 清空消息队列
- 保留 extension 监听器
- 触发 `session_before_switch` → `session_switch` 事件

#### mom 行为（文件轮转模式）
1. **归档旧文件**:
   - `context.jsonl` → `archive/context.<timestamp>.jsonl`
   - `log.jsonl` → `archive/log.<timestamp>.jsonl`
2. **创建新文件**:
   - 新的空 `context.jsonl`
   - 新的空 `log.jsonl`
3. **重置状态**:
   - 重建 `SessionManager`
   - 清理 replay 游标
   - 清理内容去重状态

#### 与 coding-agent 的差异
| 方面 | coding-agent | mom |
|------|--------------|-----|
| 文件模式 | 多 session 文件 | 固定文件 + 轮转 |
| 历史保留 | 旧文件完整保留 | 归档到 archive/ |
| 事件 | extension events | 无（暂无 extension） |

---

## 5. 并发与时序设计

### 5.1 同频道串行原则

**TUI**: 单线程，无并发问题

**mom**: 
- 每个频道一个队列（`ChannelQueue`）
- 命令和普通消息都进队列
- `/stop` 例外：立即执行，不排队

### 5.2 命令优先级

```
1. /stop      → 立即中断（高优先级，不排队）
2. /model     → 队列中执行
3. /new       → 队列中执行
4. extension  → 队列中执行（通过 AgentSession.prompt）
5. 普通消息   → 队列中执行
```

### 5.3 `/new` 与流式响应

**场景**: 用户在 agent 正在回复时执行 `/new`

**处理**:
1. `/new` 进入队列等待
2. 当前 run 完成或被 `/stop` 中断
3. `/new` 执行时，检查 `isStreaming`
4. 如果仍在流式，调用 `abort()` 等待 idle
5. 执行文件轮转

---

## 6. 错误处理

### 6.1 `/model` 错误场景

| 场景 | 行为 |
|------|------|
| 无匹配模型 | 返回候选列表，提示更精确输入 |
| 多个匹配 | 返回匹配列表，要求写全 `provider/modelId` |
| 无 API key | 返回错误，提示 `/login` 或设置环境变量 |
| 正在流式 | 仍然允许切换（下一条生效） |

### 6.2 `/new` 错误场景

| 场景 | 行为 |
|------|------|
| 正在流式 | 先 abort，再重置 |
| 归档失败 | 返回错误，保持原文件不变 |
| 创建新文件失败 | 返回错误，尝试恢复旧文件 |

### 6.3 通用错误格式

**TUI**:
- 成功: 状态栏显示 `✓ {message}`
- 失败: 状态栏显示 `✗ {error}`

**Slack**:
- 成功: 回复消息 `{message}`
- 失败: 回复消息 `Error: {error}`

---

## 7. 验证清单

### 7.1 TUI 回归测试

- [ ] `/model` 无参数显示当前模型
- [ ] `/model <exact-id>` 切换成功
- [ ] `/model <ambiguous>` 显示歧义错误
- [ ] `/model <not-found>` 显示候选
- [ ] `/new` 清空会话
- [ ] 所有其他命令行为不变

### 7.2 mom 功能测试

- [ ] `/model` 无参数返回当前模型信息
- [ ] `/model <exact-id>` 切换并确认
- [ ] 切换后下一条消息使用新模型
- [ ] 进程重启后模型保持
- [ ] `/new` 归档旧文件到 `archive/`
- [ ] `/new` 后发送消息不恢复旧上下文
- [ ] 多频道并发：A 频道 `/new` 不影响 B
- [ ] `/new` 与流式响应：先中断再重置

### 7.3 边界测试

- [ ] 空输入 `/model   ` 显示帮助
- [ ] 无效命令 `/invalid` 回复未知命令
- [ ] 命令队列满时拒绝新命令
- [ ] API key 失效时 `/model` 返回认证错误

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| TUI 行为漂移 | 用户体验不一致 | 完整回归测试 |
| `/new` 后旧日志回放 | 数据污染 | 文件轮转 + 清理 replay 状态 |
| 命令队列死锁 | 无法响应 | 超时机制 + 监控队列长度 |
| 多频道竞态 | 状态混乱 | 严格按频道串行 |
| API key 泄露 | 安全问题 | 错误消息不包含 key |

---

## 9. 后续扩展

### 9.1 短期（本计划后）

- `/compact`: 手动压缩上下文
- `/settings`: 查看当前设置
- `/help`: 命令帮助

### 9.2 中期

- `/resume`: 恢复历史会话（从 archive/ 选择）
- `/tree`: 查看会话树（mom 里可能用列表形式）
- `/fork`: 创建分支会话

### 9.3 长期

- Slack Block Kit 选择器 UI
- 命令权限控制（某些命令仅管理员可用）
- 命令审计日志

---

## 10. 成功标准

### 10.1 功能标准
- `/model` 和 `/new` 在 mom 中可用
- 行为与 coding-agent 语义对齐
- 无回归问题

### 10.2 架构标准
- 命令分发逻辑在 `core` 层
- TUI 和 mom 共用代码 > 80%
- 新增命令只需实现一个 handler

### 10.3 质量标准
- 单元测试覆盖率 > 80%
- 所有关键路径有集成测试
- 文档更新完整

---

## 11. 时间线

| 阶段 | 时间 | 产出 |
|------|------|------|
| Wave 1 | Day 1 上午 | Core 层抽象完成 |
| Wave 2 | Day 1 下午 - Day 2 上午 | TUI 重构完成 |
| Wave 3 | Day 2 下午 | mom 集成完成 |
| Wave 4 | Day 3 | 测试与文档 |

**总计**: 2-3 天
