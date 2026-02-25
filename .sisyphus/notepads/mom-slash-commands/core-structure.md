# Core 目录结构探索结果

## 1. Core 目录文件列表

```
packages/coding-agent/src/core/
├── index.ts                      # 导出入口
├── agent-session.ts              # AgentSession 类
├── model-registry.ts            # ModelRegistry 类
├── session-manager.ts            # 会话管理
├── settings-manager.ts           # 设置管理
├── slash-commands.ts             # 内置斜杠命令定义
├── skills.ts                     # 技能系统
├── timings.ts                    # 时间记录
├── system-prompt.ts              # 系统提示
├── resource-loader.ts            # 资源加载
├── keybindings.ts                # 键盘绑定
├── messages.ts                   # 消息类型
├── prompt-templates.ts           # 提示模板
├── resolve-config-value.ts       # 配置值解析
├── event-bus.ts                  # 事件总线
├── diagnostics.ts                # 诊断
├── defaults.ts                   # 默认值
├── auth-storage.ts               # 认证存储
├── bash-executor.ts              # Bash 执行
├── exec.ts                       # 执行相关
├── sdk.ts                        # SDK 入口
├── package-manager.ts            # 包管理
├── footer-data-provider.ts       # 底部数据提供者
├── tools/                        # 工具目录
│   ├── index.ts
│   ├── read.ts
│   ├── write.ts
│   ├── edit.ts
│   ├── edit-diff.ts
│   ├── bash.ts
│   ├── grep.ts
│   ├── find.ts
│   ├── ls.ts
│   ├── truncate.ts
│   └── path-utils.ts
├── extensions/                   # 扩展系统
│   ├── index.ts
│   ├── loader.ts
│   ├── runner.ts
│   ├── wrapper.ts
│   ├── types.ts
│   └── ...
├── compaction/                   # 压缩系统
│   ├── index.ts
│   ├── compaction.ts
│   ├── branch-summarization.ts
│   └── utils.ts
└── export-html/                  # HTML 导出
    ├── index.ts
    ├── ansi-to-html.ts
    └── tool-renderer.ts
```

## 2. index.ts 导出结构

```typescript
// agent-session 相关
export {
  AgentSession,
  type AgentSessionConfig,
  type AgentSessionEvent,
  type AgentSessionEventListener,
  type ModelCycleResult,
  type PromptOptions,
  type SessionStats,
} from "./agent-session.js";

// Bash 执行
export type { BashExecutorOptions, BashResult, executeBash, executeBashWithOperations } from "./bash-executor.js";

// 事件总线
export { createEventBus, type EventBus, type EventBusController } from "./event-bus.js";

// 扩展系统 (大量导出)
export { 
  // 事件类型
  type AgentEndEvent,
  type AgentStartEvent,
  type AgentToolResult,
  // ... 更多事件类型
  // 扩展加载
  discoverAndLoadExtensions,
  wrapToolsWithExtensions,
  // 扩展运行器
  ExtensionRunner,
  // ... 更多
} from "./extensions/index.js";
```

## 3. ModelRegistry 接口

位置: `/Users/cai/Dev/pi-mono/packages/coding-agent/src/core/model-registry.ts`

### 关键方法

```typescript
class ModelRegistry {
  constructor(
    readonly authStorage: AuthStorage,
    private modelsJsonPath: string | undefined = join(getAgentDir(), "models.json"),
  ) {}

  // 获取所有模型（内置 + 自定义）
  getAll(): Model<Api>[]

  // 获取已认证的模型（过滤掉没有 API key 的）
  getAvailable(): Model<Api>[]

  // 按 provider 和 modelId 查找模型
  find(provider: string, modelId: string): Model<Api> | undefined

  // 获取模型的 API key
  async getApiKey(model: Model<Api>): Promise<string | undefined>

  // 获取 provider 的 API key
  async getApiKeyForProvider(provider: string): Promise<string | undefined>

  // 检查是否使用 OAuth 认证
  isUsingOAuth(model: Model<Api>): boolean

  // 动态注册 provider（扩展使用）
  registerProvider(providerName: string, config: ProviderConfigInput): void

  // 刷新模型列表
  refresh(): void

  // 获取加载错误
  getError(): string | undefined
}
```

### ProviderConfigInput 接口 (用于动态注册)

```typescript
interface ProviderConfigInput {
  baseUrl?: string;
  apiKey?: string;
  api?: Api;
  streamSimple?: (model, context, options) => AssistantMessageEventStream;
  headers?: Record<string, string>;
  authHeader?: boolean;
  oauth?: Omit<OAuthProviderInterface, "id">;
  models?: Array<{
    id: string;
    name: string;
    api?: Api;
    reasoning: boolean;
    input: ("text" | "image")[];
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
    headers?: Record<string, string>;
    compat?: Model<Api>["compat"];
  }>;
}
```

## 4. AgentSession 接口

位置: `/Users/cai/Dev/pi-mono/packages/coding-agent/src/core/agent-session.ts`

### 关键方法

```typescript
class AgentSession {
  // 模型管理
  async setModel(model: Model<any>): Promise<void>
  async cycleModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined>
  
  // 会话管理
  async newSession(options?: {
    parentSession?: string;
    setup?: (sessionManager: SessionManager) => Promise<void>;
  }): Promise<boolean>
  
  // 中止操作
  async abort(): Promise<void>
  
  // 发送提示
  async prompt(text: string, options?: PromptOptions): Promise<void>
  
  // 消息队列
  async steer(text: string, images?: ImageContent[]): Promise<void>
  async followUp(text: string, images?: ImageContent[]): Promise<void>
  clearQueue(): { steering: string[]; followUp: string[] }
  
  // 思考级别
  setThinkingLevel(level: ThinkingLevel): void
  cycleThinkingLevel(): ThinkingLevel | undefined
  
  // 压缩
  async compact(customInstructions?: string): Promise<CompactionResult>
  abortCompaction(): void
  
  // 工具管理
  getActiveToolNames(): string[]
  setActiveToolNames(toolNames: string[]): void
  
  // 事件订阅
  subscribe(listener: AgentSessionEventListener): () => void
  dispose(): void
}
```

### 属性

```typescript
// 状态访问
readonly state: AgentState
readonly model: Model<any> | undefined
readonly thinkingLevel: ThinkingLevel
readonly isStreaming: boolean
readonly systemPrompt: string
readonly retryAttempt: number

// 会话信息
readonly sessionId: string
readonly sessionFile: string | undefined
readonly sessionName: string | undefined

// 消息
readonly messages: AgentMessage[]
readonly pendingMessageCount: number

// 模型注册表
readonly modelRegistry: ModelRegistry

// 资源
readonly resourceLoader: ResourceLoader
readonly promptTemplates: ReadonlyArray<PromptTemplate>
readonly scopedModels: ReadonlyArray<{ model: Model<any>; thinkingLevel: ThinkingLevel }>
```

## 5. 现有斜杠命令

位置: `/Users/cai/Dev/pi-mono/packages/coding-agent/src/core/slash-commands.ts`

```typescript
const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
  { name: "settings", description: "Open settings menu" },
  { name: "model", description: "Select model (opens selector UI)" },
  { name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
  { name: "export", description: "Export session to HTML file" },
  { name: "share", description: "Share session as a secret GitHub gist" },
  { name: "copy", description: "Copy last agent message to clipboard" },
  { name: "name", description: "Set session display name" },
  { name: "session", description: "Show session info and stats" },
  { name: "changelog", description: "Show changelog entries" },
  { name: "hotkeys", description: "Show all keyboard shortcuts" },
  { name: "fork", description: "Create a new fork from a previous message" },
  { name: "tree", description: "Navigate session tree (switch branches)" },
  { name: "login", description: "Login with OAuth provider" },
  { name: "logout", description: "Logout from OAuth provider" },
  { name: "new", description: "Start a new session" },
  { name: "compact", description: "Manually compact the session context" },
  { name: "resume", description: "Resume a different session" },
  { name: "reload", description: "Reload extensions, skills, prompts, and themes" },
  { name: "quit", description: "Quit pi" },
];
```

### 命令类型定义

```typescript
type SlashCommandSource = "extension" | "prompt" | "skill";
type SlashCommandLocation = "user" | "project" | "path";

interface SlashCommandInfo {
  name: string;
  description?: string;
  source: SlashCommandSource;
  location?: SlashCommandLocation;
  path?: string;
}
```

## 6. 重要发现

1. **命令实现**: 内置命令定义在 `slash-commands.ts`，但实际处理逻辑在交互模式组件中（`modes/interactive/components/`）

2. **扩展命令**: 扩展可以通过 `ExtensionRunner` 注册自定义命令，调用 `_tryExecuteExtensionCommand` 处理

3. **模型切换**: `AgentSession.setModel()` 会验证 API key，保存到会话和设置

4. **会话管理**: `newSession()` 支持 parentSession 追踪，可选 setup 回调

5. **API Key 获取**: `ModelRegistry.getApiKey()` 和 `getApiKeyForProvider()` 是关键方法

## 7. 相关文件位置

- 主入口: `/Users/cai/Dev/pi-mono/packages/coding-agent/src/index.ts`
- 交互模式: `/Users/cai/Dev/pi-mono/packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- 扩展系统: `/Users/cai/Dev/pi-mono/packages/coding-agent/src/core/extensions/index.ts`
- SDK 入口: `/Users/cai/Dev/pi-mono/packages/coding-agent/src/core/sdk.ts`
