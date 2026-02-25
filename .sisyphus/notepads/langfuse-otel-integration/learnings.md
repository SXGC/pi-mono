# Learnings: Langfuse OTEL Integration

## 2026-02-24: Settings Schema Design

### Settings Pattern in packages/coding-agent
- Interface 定义放在 `settings-manager.ts` 文件顶部，按功能分组
- 嵌套设置使用可选字段，避免破坏向后兼容
- Getter 返回默认值模式：`this.settings.field?.subfield ?? defaultValue`
- Setter 使用 `markModified(field)` 或 `markModified(field, "nestedKey")` 标记修改
- 对于嵌套对象设置，直接设置整个对象即可（不像 CompactionSettings 那样需要初始化空对象再设置单个属性）

### LangfuseSettings Schema
```typescript
export interface LangfuseSettings {
  enabled: boolean;      // required - 控制是否启用追踪
  secretKey?: string;    // optional - Langfuse secret key
  publicKey?: string;    // optional - Langfuse public key
  baseUrl?: string;      // optional - 自定义 Langfuse 服务器地址
}
```

- `enabled` 是必填字段，默认 `false`，确保用户明确启用
- 凭证字段都是可选的，后续可从环境变量读取
- `baseUrl` 支持自托管 Langfuse 实例
## 2026-02-24: Langfuse and OpenTelemetry Dependencies Added

### Packages Added
- `@langfuse/otel`: ^4.6.1
- `@opentelemetry/sdk-node`: ^0.212.0
- `@opentelemetry/api`: ^1.9.0

### Notes
- Peer dependency warning about zod (pre-existing, not related to new deps)

## 2026-02-24: Telemetry Module Skeleton Created

### File Structure
```
packages/ai/src/telemetry/
├── index.ts    # Public API exports
├── tracer.ts   # NodeSDK and LangfuseSpanProcessor initialization
└── types.ts    # TelemetryConfig interface
```

### Implementation Notes
- `initTelemetry(config)`: Returns shutdown function, silently returns no-op if disabled or missing credentials
- Credentials fallback order: config params → environment variables (LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_BASE_URL)
- Initialization failures use `console.warn` and gracefully degrade (no throwing)
- Module exported via `packages/ai/src/index.ts`



## 2026-02-24: Coding-Agent Telemetry Module Created

### File Structure
```
packages/coding-agent/src/telemetry/
├── index.ts    # Public API exports
├── tracer.ts   # Tracer helpers (getTracer, startSessionSpan, startTurnSpan, startToolSpan)
└── types.ts    # Re-exports TelemetryConfig from @mariozechner/pi-ai
```

### Implementation Notes
- `initCodingAgentTelemetry(config)`: Delegates to `@mariozechner/pi-ai` initTelemetry, creates tracer
- `shutdownCodingAgentTelemetry()`: Delegates to ai package shutdown
- `getTracer()`: Returns OpenTelemetry Tracer or undefined
- `isTelemetryEnabled()`: Returns boolean for telemetry state
- Span helpers:
  - `startSessionSpan(sessionId)` - Creates session-level span
  - `startTurnSpan(sessionId, turnIndex, parentSpan?)` - Creates turn span
  - `startToolSpan(toolName, parentSpan?)` - Creates tool execution span
- All span helpers return undefined if telemetry is disabled (safe no-op pattern)
- Module is NOT exported via packages/coding-agent/src/index.ts (internal use only)

## 2026-02-24: LLM Call Tracing in stream.ts

### Implementation Pattern
- Added `getTracer()` and `isTelemetryEnabled()` functions to `packages/ai/src/telemetry/tracer.ts`
- `getTracer()` returns `Tracer | undefined` (undefined if telemetry not initialized)
- `isTelemetryEnabled()` returns boolean based on SDK initialization state

### Span Creation in stream()
- Span name: `"llm-call"`
- Span attributes:
  - `gen_ai.request.model`: Model ID
  - `gen_ai.request.provider`: Provider name
  - `session.id`: Optional session ID from StreamOptions

### Stream Wrapping Pattern
- Created `wrapStreamWithSpan()` helper function
- Wraps `AssistantMessageEventStream` to intercept events
- On `done` event: records usage (`input_tokens`, `output_tokens`) and `cost.total`
- On `error` event: records exception with `span.recordException()`
- Uses async IIFE to forward events without blocking
- Type `Span` imported from `@opentelemetry/api` for proper typing

### Key Design Decisions
- Telemetry is opt-in: if not enabled, returns original stream unchanged
- Span updates are asynchronous (IIFE pattern), don't block streaming
- Errors during event forwarding are caught and recorded to span
- Re-exported `getTracer` and `isTelemetryEnabled` from `telemetry/index.ts`

### Export Updates
- `packages/ai/src/telemetry/index.ts` now exports:
  - `initTelemetry`, `shutdownTelemetry`
  - `getTracer`, `isTelemetryEnabled` (new)
  - `TelemetryConfig` type


## 2026-02-24: Session/Turn Span Tracking in AgentSession

### Implementation Location
- File: `packages/coding-agent/src/core/agent-session.ts`
- Method: `_emitExtensionEvent()` - handles telemetry spans before extension events

### Private Fields Added
```typescript
// Telemetry spans
private _currentSessionSpan: ReturnType<typeof startSessionSpan> = undefined;
private _currentTurnSpans: Map<number, ReturnType<typeof startTurnSpan>> = new Map();
```

### Span Lifecycle
1. `agent_start`: Creates session span via `startSessionSpan(this.sessionId)`
2. `turn_start`: Creates turn span via `startTurnSpan(sessionId, turnIndex, sessionSpan)`
3. `turn_end`: Ends turn span via `turnSpan.end()`
4. `agent_end`: Ends session span via `sessionSpan.end()`

### Key Design Decisions
- Span tracking is independent of extension runner (runs even without extensions)
- Uses `ReturnType<typeof startSessionSpan>` for type safety (returns `Span | undefined`)
- All span operations are non-blocking (telemetry disabled = no-op)
- Turn spans are stored in Map by turnIndex for proper cleanup

### Span Attributes
- Session span: `session.id`
- Turn span: `session.id`, `turn.index`

## 2026-02-24: Tool Execution Span Tracking in AgentSession

### Implementation Location
- File: `packages/coding-agent/src/core/agent-session.ts`
- Method: `_emitExtensionEvent()` - tool span handling added to telemetry section

### Private Field Added
```typescript
private _currentToolSpans: Map<string, import("@opentelemetry/api").Span> = new Map();
```

### Import Update
```typescript
import { startSessionSpan, startToolSpan, startTurnSpan } from "../telemetry/index.js";
```

### Span Lifecycle
1. `tool_execution_start`: Creates tool span as child of current turn span
2. `tool_execution_end`: Ends tool span and removes from map

### Span Attributes
- `tool.name`: Name of the tool (set on creation)
- `tool.call_id`: Unique identifier for the tool call
- `tool.is_error`: Boolean indicating if execution resulted in error (set on end)

### Key Design Decisions
- Tool spans are children of turn spans (parent: `this._currentTurnSpans.get(this._turnIndex)`)
- Tool spans stored in Map by `toolCallId` for proper lifecycle management
- Uses inline import `import("@opentelemetry/api").Span` to avoid top-level dependency
- All span operations are non-blocking (telemetry disabled = no-op)
- Does NOT record full tool result (only error status) to avoid large spans
## 2026-02-24: Telemetry Initialization in main.ts

### Implementation Location
- File: `packages/coding-agent/src/main.ts`
- Position: After `modelRegistry` creation, before `resourceLoader` creation

### Initialization Pattern
```typescript
const langfuseSettings = settingsManager.getLangfuseSettings();
if (langfuseSettings.enabled) {
  if (!langfuseSettings.secretKey || !langfuseSettings.publicKey) {
    console.warn(
      chalk.yellow(
        "Langfuse telemetry enabled but credentials not configured. Skipping telemetry initialization.",
      ),
    );
  } else {
    initCodingAgentTelemetry(langfuseSettings);
  }
}
```

### Key Design Decisions
- Telemetry initialized early in main() after settings are loaded
- Graceful degradation: warning on missing credentials, not error
- No shutdown function storage needed (process exit handles cleanup)
- Import added at top of file alongside other telemetry imports

### Dependencies Added
- `@opentelemetry/sdk-trace-base` as devDependency (for test types)

## 2026-02-24: Error Handling and Graceful Degradation

### Error Handling Pattern
- All telemetry operations wrapped in try-catch
- Errors logged via `console.warn()` - never thrown
- Operations return fallback values on failure (undefined for span operations)

### packages/ai/src/telemetry/tracer.ts
- `shutdownTelemetry()`: Added try-catch with finally to ensure `sdk = undefined`
- Added `safeSpanOperation<T>(operation, fallback)` helper function for safe span operations
- Exported `safeSpanOperation` from telemetry/index.ts

### packages/coding-agent/src/telemetry/tracer.ts
- `startSessionSpan()`: Try-catch wrapping, returns undefined on error
- `startTurnSpan()`: Try-catch wrapping, returns undefined on error  
- `startToolSpan()`: Try-catch wrapping, returns undefined on error
- All failures logged via `console.warn("Failed to start X span:", error)`

### packages/ai/src/stream.ts
- `wrapStreamWithSpan()`: All span operations wrapped individually:
  - `span.setAttributes()` - wrapped in try-catch
  - `span.recordException()` - wrapped in try-catch
  - `span.end()` - wrapped in try-catch
- Telemetry failures never interrupt the event stream

### Key Design Decisions
- Fail-fast on telemetry errors is NOT appropriate - always degrade gracefully
- Each span operation is independently protected (not grouped in single try-catch)
- This allows partial telemetry success (e.g., attributes set even if end() fails)

## 2026-02-24: Telemetry E2E Test Pattern (coding-agent)

### 新增测试文件
- `packages/coding-agent/test/telemetry/e2e.test.ts`

### 可复用测试模式
- 用 `vi.mock("@langfuse/otel")` 注入本地 `MockLangfuseSpanProcessor`，在 `onEnd()` 收集 finished spans，避免真实 Langfuse 凭证和网络请求
- 在 AI API Registry 中注册自定义 mock provider（`registerApiProvider` + `unregisterApiProviders`），用 `createAssistantMessageEventStream()` 主动推送 `done` / `error` 事件
- 通过 `context.with(trace.setSpan(...))` 构造 parent-child 层级，稳定验证 `session -> turn -> llm-call` 关系
- `tool` span 通过 coding-agent 的 `startToolSpan()` 追加业务属性（`tool.call_id`, `tool.is_error`）并断言结束状态

### 断言重点
- 层级：`parentSpanContext.spanId` 与父 span `spanContext().spanId` 一致
- 属性完整性：
  - session: `session.id`
  - turn: `session.id`, `turn.index`
  - llm: `gen_ai.request.*`, `session.id`, `gen_ai.usage.*`, `gen_ai.cost.total`
  - tool: `tool.name`, `tool.call_id`, `tool.is_error`
- 生命周期：`ended === true`，并用 hrTime 顺序校验调用链时序
- 错误路径：error 流程下 `llm-call` span 包含 `exception` event 且正确结束
