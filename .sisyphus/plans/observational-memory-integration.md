# pi-mono 嵌入 Observational Memory 计划

## 当前架构分析

### 现有上下文管理机制

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent 当前架构                            │
├─────────────────────────────────────────────────────────────┤
│  agent-loop.ts                                              │
│  ├── runLoop() ──────────────────────────┐                  │
│  │   └── streamAssistantResponse()       │                  │
│  │       ├── transformContext() ←── 压缩钩子（可选）        │
│  │       ├── convertToLlm()     ←── 消息转换                │
│  │       └── streamSimple()     ←── LLM 调用               │
│  └── executeToolCalls()                                     │
└─────────────────────────────────────────────────────────────┘
```

### 现有 Compaction 机制

**位置**: `coding-agent/src/core/compaction/compaction.ts`

| 特性 | 当前实现 |
|------|----------|
| **触发时机** | 上下文超过 `contextWindow - reserveTokens` |
| **策略** | 保留最近 `keepRecentTokens`（默认 20k），丢弃前面的消息 |
| **压缩方式** | 一次性 LLM 总结，生成结构化 checkpoint |
| **存储格式** | 文本摘要 + 文件操作列表 |
| **迭代更新** | 支持，基于上次 summary 增量更新 |

**问题**:
1. 触发阈值高（一次性压缩），延迟大
2. 压缩是破坏性的，信息损失较大
3. 不支持细粒度优先级标记
4. 没有异步缓冲机制

### Mastra OM vs pi-mono Compaction

| 维度 | Mastra OM | pi-mono Compaction |
|------|-----------|-------------------|
| **触发机制** | 30k tokens 触发 + 异步缓冲 | 到达阈值一次性触发 |
| **压缩粒度** | 增量观察（每 6k 预计算） | 批量总结 |
| **上下文结构** | Reflections → Observations → Messages | Summary → Kept Messages |
| **优先级** | Emoji 标记（🔴🟡🟢） | 无 |
| **时间模型** | 三日期模型 | 简单时间戳 |
| **prompt cache** | 稳定前缀，可缓存 | 每次不同 |

---

## 嵌入方案

### 方案 A: 最小改动 - TransformContext 钩子（推荐）

**改动范围**: 仅 `AgentOptions.transformContext`

```typescript
// packages/agent/src/agent.ts 新增选项
export interface AgentOptions {
  // ... 现有选项
  
  /**
   * Observational Memory 配置
   * 渐进式压缩，替代 transformContext 中的手动压缩
   */
  observationalMemory?: {
    enabled: boolean;
    /** 观察阈值，默认 30_000 */
    observationThreshold?: number;
    /** 反思阈值，默认 40_000 */
    reflectionThreshold?: number;
    /** 用于 Observer/Reflector 的模型 */
    model: Model<any>;
    /** 异步缓冲步长，默认 0.2 (20%) */
    bufferRatio?: number;
  };
}
```

**实现逻辑**:

```typescript
// agent-loop.ts 中
async function streamAssistantResponse(...) {
  let messages = context.messages;
  
  // === 新增：Observational Memory ===
  if (config.observationalMemory?.enabled) {
    messages = await applyObservationalMemory(
      messages, 
      config.observationalMemory,
      config.getApiKey
    );
  }
  // =================================
  
  // 原有的 transformContext
  if (config.transformContext) {
    messages = await config.transformContext(messages, signal);
  }
  
  // ... 后续逻辑
}
```

**核心函数设计**:

```typescript
interface ObservationLog {
  threadId: string;
  reflections: string;      // 最高层压缩
  observations: string;     // 中层压缩
  messages: AgentMessage[]; // 保留的原始消息
  lastUpdated: number;
}

async function applyObservationalMemory(
  messages: AgentMessage[],
  config: ObservationalMemoryConfig,
  getApiKey?: () => Promise<string | undefined>
): Promise<AgentMessage[]> {
  const tokenCount = estimateTokens(messages);
  
  // 1. 检查是否需要观察
  if (tokenCount <= config.observationThreshold) {
    return messages; // 短对话，不处理
  }
  
  // 2. 从存储加载 observation log
  const log = await loadObservationLog(threadId);
  
  // 3. 计算新消息（上次观察后的消息）
  const newMessages = messages.slice(log.lastMessageIndex);
  
  // 4. 异步缓冲观察
  const observations = await observer.observe(newMessages, {
    model: config.model,
    apiKey: await getApiKey?.(),
  });
  
  // 5. 检查是否需要反思
  if (log.observations.length > config.reflectionThreshold) {
    const reflection = await reflector.reflect(log.observations, {
      model: config.model,
      apiKey: await getApiKey?.(),
    });
    log.reflections = reflection;
    log.observations = await compressObservations(log.observations);
  }
  
  // 6. 构建上下文窗口
  const contextMessage: AgentMessage = {
    role: "user",
    content: formatObservations(log),
    timestamp: Date.now(),
  };
  
  // 7. 保留最近的原始消息（默认 20%）
  const recentMessages = messages.slice(-Math.floor(messages.length * 0.2));
  
  return [contextMessage, ...recentMessages];
}
```

**存储设计**:

```typescript
// 使用现有 session 存储机制
// 路径: ~/.pi/sessions/{sessionId}/observations.jsonl

interface ObservationEntry {
  type: "observation" | "reflection";
  content: string;
  timestamp: number;
  tokenCount: number;
  priority?: "red" | "yellow" | "green";
}
```

### 方案 B: 中等改动 - Agent 内部状态管理

**改动范围**: `Agent` 类 + `AgentState`

```typescript
// types.ts 新增
export interface AgentState {
  // ... 现有字段
  observationalMemory?: {
    reflections: string;
    observations: string;
    lastObservationTime: number;
  };
}
```

**Observer/Reflector 实现**:

```typescript
// packages/agent/src/observational-memory/
// ├── observer.ts      - 观察 Agent
// ├── reflector.ts     - 反思 Agent
// ├── formatter.ts     - 格式化 observations
// └── storage.ts       - 存储适配器

class Observer {
  constructor(
    private model: Model<any>,
    private apiKey?: string
  ) {}
  
  async observe(messages: AgentMessage[]): Promise<string> {
    const prompt = buildObserverPrompt(messages);
    const response = await completeSimple(this.model, prompt, { apiKey: this.apiKey });
    return formatObservation(response);
  }
}

class Reflector {
  async reflect(observations: string[]): Promise<string> {
    // 合并相关观察，识别模式
  }
}
```

### 方案 C: 完整实现 - 独立 Memory 层

**改动范围**: 新增 `@mariozechner/pi-memory` 包

```
packages/
├── agent/           # 依赖 pi-memory
├── ai/
├── memory/          # 新增：Observational Memory 实现
│   ├── src/
│   │   ├── index.ts
│   │   ├── observational-memory.ts
│   │   ├── storage/
│   │   │   ├── file.ts
│   │   │   └── pg.ts
│   │   └── types.ts
│   └── package.json
├── coding-agent/
└── ...
```

---

## 推荐方案：方案 A（TransformContext 钩子）

### 理由

1. **最小侵入**: 不改现有 Agent 类结构，只添加可选配置
2. **向后兼容**: 不启用时，行为完全不变
3. **渐进式**: 可先在小范围测试，再推广
4. **可组合**: 与现有 `transformContext` 和 `compaction` 共存

### 具体改动点

#### 1. 类型定义（packages/agent/src/types.ts）

```typescript
export interface ObservationalMemoryConfig {
  enabled: boolean;
  /** 观察阈值，默认 30000 */
  observationThreshold?: number;
  /** 反思阈值，默认 40000 */
  reflectionThreshold?: number;
  /** 后台模型，默认 google/gemini-2.5-flash */
  model?: Model<any>;
  /** 缓冲比例，默认 0.2 */
  bufferRatio?: number;
  /** 保留最近消息比例，默认 0.2 */
  retentionRatio?: number;
}

export interface AgentLoopConfig extends SimpleStreamOptions {
  // ... 现有字段
  observationalMemory?: ObservationalMemoryConfig;
}
```

#### 2. Agent 选项（packages/agent/src/agent.ts）

```typescript
export interface AgentOptions {
  // ... 现有选项
  observationalMemory?: ObservationalMemoryConfig;
}

// Agent 构造函数中
if (opts.observationalMemory?.enabled) {
  // 包装 transformContext
  const originalTransform = this.transformContext;
  this.transformContext = async (messages, signal) => {
    // 先应用 OM
    const omMessages = await applyObservationalMemory(
      messages,
      opts.observationalMemory!,
      opts.sessionId,
      this.getApiKey
    );
    // 再应用原有的 transform
    return originalTransform ? await originalTransform(omMessages, signal) : omMessages;
  };
}
```

#### 3. Observational Memory 实现（新增文件）

```typescript
// packages/agent/src/observational-memory.ts

import type { AgentMessage } from "./types.js";
import { completeSimple, type Model } from "@mariozechner/pi-ai";

interface ObservationLog {
  threadId: string;
  reflections: string;
  observations: string;
  lastMessageCount: number;
  lastUpdated: number;
}

const OBSERVER_PROMPT = `你是一个观察者，负责将对话压缩成简洁的观察日志。

格式:
Date: YYYY-MM-DD
- 🔴 HH:MM [重要事实] (优先级最高)
- 🟡 HH:MM [次要信息]
- 🟢 HH:MM [背景信息]

规则:
1. 保留时间戳和日期
2. 使用 emoji 标记优先级
3. 保留关键实体名称
4. 追踪当前任务状态
5. 生成建议的下一步响应`;

const REFLECTOR_PROMPT = `你是一个反思者，负责将多个观察合并成更高层的总结。

任务:
1. 合并相关的观察
2. 识别模式和趋势
3. 压缩冗余信息
4. 保留时间线
5. 维护任务连续性`;

export async function applyObservationalMemory(
  messages: AgentMessage[],
  config: Required<ObservationalMemoryConfig>,
  threadId: string,
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined
): Promise<AgentMessage[]> {
  // ... 实现逻辑
}
```

#### 4. 存储适配（复用现有 session 存储）

```typescript
// 存储路径: ~/.pi/sessions/{sessionId}/om-log.json

async function loadObservationLog(threadId: string): Promise<ObservationLog> {
  const path = join(PI_DIR, "sessions", threadId, "om-log.json");
  try {
    const data = await readFile(path, "utf-8");
    return JSON.parse(data);
  } catch {
    return {
      threadId,
      reflections: "",
      observations: "",
      lastMessageCount: 0,
      lastUpdated: Date.now(),
    };
  }
}
```

### 集成示例

```typescript
// coding-agent 中使用
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";

const agent = new Agent({
  initialState: {
    systemPrompt: "你是一个编码助手...",
    model: getModel("openai", "gpt-4o"),
    // ...
  },
  
  // 启用 Observational Memory
  observationalMemory: {
    enabled: true,
    observationThreshold: 30_000,
    reflectionThreshold: 40_000,
    model: getModel("google", "gemini-2.5-flash"), // 后台模型
  },
});
```

### 与现有 Compaction 的协作

```typescript
// 可以同时启用两者，OM 先执行，Compaction 作为后备
const agent = new Agent({
  observationalMemory: {
    enabled: true,
    observationThreshold: 30_000,
  },
  
  // 当 OM 无法处理（如存储失败）时，回退到 compaction
  transformContext: async (messages) => {
    if (shouldFallbackToCompaction(messages)) {
      return compactMessages(messages);
    }
    return messages; // OM 已处理
  },
});
```

---

## 实施步骤

### Phase 1: 核心实现（1-2 天）

1. **新增文件**: `packages/agent/src/observational-memory.ts`
   - Observer/Reflector 提示词
   - 消息压缩逻辑
   - 存储读写

2. **修改文件**: `packages/agent/src/types.ts`
   - 添加 `ObservationalMemoryConfig` 接口

3. **修改文件**: `packages/agent/src/agent.ts`
   - 在构造函数中处理 `observationalMemory` 选项

4. **修改文件**: `packages/agent/src/agent-loop.ts`
   - 在 `streamAssistantResponse` 中调用 OM

### Phase 2: 集成测试（1 天）

1. 在 `coding-agent` 中添加测试用例
2. 测试长对话场景（> 100k tokens）
3. 对比启用/禁用 OM 的性能和准确率

### Phase 3: 优化迭代（按需）

1. 异步缓冲实现（减少延迟）
2. Resource Scope（跨会话记忆）
3. 观察/反思质量评估

---

## 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 后台模型调用增加成本 | 高 | 中 | 使用便宜模型（gemini-flash）|
| 异步观察延迟 | 中 | 低 | 阈值调低，缓冲步长调小 |
| 信息丢失 | 中 | 高 | 保留原始消息比例可调 |
| 存储膨胀 | 低 | 低 | 定期清理旧 observation |
| 与现有 compaction 冲突 | 低 | 中 | 两者互斥，文档说明 |

---

## 预期效果

| 指标 | 当前 | 启用 OM 后 | 对比 |
|------|------|-----------|------|
| 长对话准确率 | 基准 | +15-25% | 参考 Mastra LongMemEval 84% |
| 上下文窗口稳定性 | 不固定 | 固定结构 | Prompt cacheable |
| Token 成本 | 基准 | -20-40% | 压缩比 5-40x |
| 响应延迟 | 基准 | 略增加 | 后台模型调用 |

---

## 参考资源

- Mastra OM 文档: https://mastra.ai/docs/memory/observational-memory
- Mastra OM 实现: https://github.com/mastra-ai/mastra
- Mastra 研究博客: https://mastra.ai/research/observational-memory
- LongMemEval 基准: https://github.com/xiaowu0162/LongMemEval
