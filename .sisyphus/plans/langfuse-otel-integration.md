# Langfuse OpenTelemetry 集成

## TL;DR

> **Quick Summary**: 为 pi-mono 添加 OpenTelemetry 埋点，通过 Langfuse 实现 LLM 调用和 Agent 生命周期的完整可观测性。
> 
> **Deliverables**: 
> - packages/ai 的 LLM 调用追踪（token、成本、响应）
> - packages/coding-agent 的会话生命周期追踪（session、turn、tool）
> - 配置文件支持（启用/禁用、凭证管理）
> - 异步上报机制（不阻塞主流程）
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: 配置 → packages/ai → packages/coding-agent

---

## Context

### Original Request
通过 OpenTelemetry 接入 Langfuse：https://langfuse.com/docs/observability/get-started

### Interview Summary
**Key Discussions**:
- **集成范围**: packages/ai（LLM 调用层）+ coding-agent（Agent 生命周期）+ mom（继承 coding-agent）
- **埋点粒度**: 完整追踪（session → turn → LLM call → tool）
- **数据隐私**: 记录完整内容（消息、参数、响应、token、成本）
- **配置策略**: 配置文件控制（启用/禁用 + 凭证）
- **性能策略**: 异步上报，不阻塞主流程
- **兼容性**: 保持现有日志系统，OTel 作为新增层

**Research Findings**:
- packages/ai 已有完整事件流（start/text_delta/toolcall_delta/done）
- coding-agent 已有 ExtensionRunner 事件分发机制
- Token 统计在各 provider 实现（anthropic.ts、openai-responses-shared.ts）
- 成本计算在 models.ts:calculateCost

### Metis Review
**Identified Gaps** (addressed):
- 配置文件 schema 设计（确保向后兼容）
- 错误处理策略（Langfuse 上报失败时的降级方案）
- 测试策略（如何验证追踪正确性）

---

## Work Objectives

### Core Objective
为 pi-mono 添加 OpenTelemetry 埋点，通过 Langfuse 实现：
1. LLM 调用的完整追踪（输入、输出、token、成本）
2. Agent 生命周期的可观测性（session、turn、tool execution）
3. 配置化的启用/禁用控制
4. 异步上报机制，不影响主流程性能

### Concrete Deliverables
- `packages/ai/src/telemetry/` - OpenTelemetry 初始化和 span 创建
- `packages/coding-agent/src/telemetry/` - Agent 生命周期追踪
- 配置文件 schema 更新（添加 langfuse 字段）
- CHANGELOG 更新（packages/ai、coding-agent）

### Definition of Done
- [ ] LLM 调用生成完整 span（包含 model、tokens、cost）
- [ ] Agent 生命周期事件生成 span（session/turn/tool）
- [ ] 配置文件支持 langfuse 启用/禁用
- [ ] 异步上报机制工作正常
- [ ] 现有日志系统不受影响
- [ ] 文档更新（README、CHANGELOG）

### Must Have
- ✅ packages/ai 的 LLM 调用追踪
- ✅ packages/coding-agent 的会话追踪
- ✅ 配置文件控制
- ✅ 异步上报
- ✅ 完整内容记录（消息、token、成本）

### Must NOT Have (Guardrails)
- ❌ 不修改现有日志系统（log.jsonl、RPC 事件流）
- ❌ 不阻塞主流程（必须异步上报）
- ❌ 不添加环境变量配置（使用配置文件）
- ❌ 不追踪 packages/tui、web-ui
- ❌ 不采样/过滤内容（记录完整数据）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest in packages/ai, coding-agent)
- **Automated tests**: YES (TDD)
- **Framework**: vitest
- **TDD**: 每个任务遵循 RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Backend/Module**: Use Bash (bun/node REPL) — Import, call functions, verify span attributes
- **Configuration**: Use Bash — Read config file, validate schema
- **Integration**: Use Bash — Run agent, verify Langfuse receives traces (mock server)

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — configuration + dependencies):
├── Task 1: 添加依赖包 [quick]
├── Task 2: 设计配置 schema [quick]
└── Task 3: 创建 packages/ai/telemetry 模块骨架 [quick]

Wave 2 (After Wave 1 — core instrumentation):
├── Task 4: packages/ai LLM 调用追踪 [unspecified-high]
├── Task 5: packages/coding-agent telemetry 模块 [quick]
├── Task 6: packages/coding-agent session/turn 追踪 [unspecified-high]
└── Task 7: packages/coding-agent tool execution 追踪 [unspecified-high]

Wave 3 (After Wave 2 — integration + verification):
├── Task 8: 集成测试（完整调用链） [deep]
├── Task 9: 配置文件加载和验证 [quick]
├── Task 10: 错误处理和降级 [unspecified-high]
└── Task 11: 文档更新 [writing]

Wave FINAL (After ALL tasks — verification):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
```

### Dependency Matrix

- **1-3**: — — 4-7
- **4**: 1, 3 — 8
- **5-7**: 1 — 8
- **8**: 4, 6, 7 — F1-F4
- **9-11**: 2 — F1-F4

### Agent Dispatch Summary

- **Wave 1**: **3** — T1-T2 → `quick`, T3 → `quick`
- **Wave 2**: **4** — T4 → `unspecified-high`, T5 → `quick`, T6-T7 → `unspecified-high`
- **Wave 3**: **4** — T8 → `deep`, T9 → `quick`, T10 → `unspecified-high`, T11 → `writing`
- **Wave FINAL**: **4** — F1 → `oracle`, F2-F3 → `unspecified-high`, F4 → `deep`

---

## TODOs
- [ ] 1. 添加 Langfuse 和 OpenTelemetry 依赖包

  **What to do**:
  - 在 packages/ai/package.json 添加依赖：@langfuse/otel、@opentelemetry/sdk-node、@opentelemetry/api
  - 在 packages/coding-agent/package.json 添加相同依赖
  - 运行 pnpm install 确保依赖安装成功
  - 创建简单的导入测试验证依赖可用

  **Must NOT do**:
  - 不添加其他不必要的 OpenTelemetry 包（如 exporter-trace-otlp）
  - 不修改 pnpm-lock.yaml（让 pnpm install 自动处理）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的依赖添加，无需复杂逻辑
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `git-master`: 不需要复杂 git 操作

  **Parallelization**:
  - **Can Run In Parallel**: NO（基础依赖，其他任务依赖此任务）
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 2-7
  - **Blocked By**: None

  **References**:
  - `packages/ai/package.json` - 添加 @langfuse/otel 依赖
  - `packages/coding-agent/package.json` - 添加相同依赖
  - Langfuse 官方文档: https://langfuse.com/docs/observability/get-started

  **Acceptance Criteria**:
  - [ ] packages/ai/package.json 包含 @langfuse/otel、@opentelemetry/sdk-node、@opentelemetry/api
  - [ ] packages/coding-agent/package.json 包含相同依赖
  - [ ] pnpm install 成功执行
  - [ ] bun pm ls | grep -E "@langfuse|@opentelemetry" 显示依赖

  **QA Scenarios**:
  ```
  Scenario: 依赖安装成功
    Tool: Bash
    Preconditions: package.json 已更新
    Steps:
      1. cd packages/ai && bun pm ls | grep "@langfuse/otel"
      2. cd packages/coding-agent && bun pm ls | grep "@langfuse/otel"
    Expected Result: 两个包都显示 @langfuse/otel 版本号
    Failure Indicators: "cannot find" 或无输出
    Evidence: .sisyphus/evidence/task-01-deps-installed.txt
  ```

  **Evidence to Capture**:
  - [ ] bun pm ls 输出显示依赖已安装

  **Commit**: YES (Wave 1)
  - Message: `feat(telemetry): add langfuse and opentelemetry dependencies`
  - Files: packages/ai/package.json, packages/coding-agent/package.json
  - Pre-commit: pnpm install && bun pm ls | grep -E "@langfuse|@opentelemetry"

- [ ] 2. 设计配置 schema（langfuse 字段）

  **What to do**:
  - 在 packages/coding-agent/src/config/schema.ts 添加 langfuse 配置字段
  - 字段包括：enabled (boolean)、secretKey (string)、publicKey (string)、baseUrl (string, 可选)
  - 使用 Zod 或类似库定义 schema
  - 添加默认值（enabled: false）
  - 编写单元测试验证 schema 解析

  **Must NOT do**:
  - 不破坏现有配置结构（向后兼容）
  - 不添加环境变量支持（只用配置文件）
  - 不验证凭证有效性（只验证格式）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的 schema 定义，无需复杂逻辑
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 1 并行）
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Tasks 9-11
  - **Blocked By**: None

  **References**:
  - `packages/coding-agent/src/config/schema.ts` - 现有配置 schema
  - `packages/coding-agent/src/config/types.ts` - 配置类型定义

  **Acceptance Criteria**:
  - [ ] langfuse schema 定义在 config/schema.ts
  - [ ] 字段：enabled (boolean, required), secretKey (string, optional), publicKey (string, optional), baseUrl (string, optional)
  - [ ] 默认值：enabled: false
  - [ ] 单元测试通过：bun test config/schema.test.ts

  **QA Scenarios**:
  ```
  Scenario: 配置 schema 解析正确
    Tool: Bash
    Preconditions: schema.ts 已更新
    Steps:
      1. cd packages/coding-agent
      2. bun test src/config/schema.test.ts
      3. cat test/fixtures/config-with-langfuse.json | bun run src/config/parse.ts
    Expected Result: 测试通过，配置解析成功
    Failure Indicators: 测试失败，解析错误
    Evidence: .sisyphus/evidence/task-02-schema-parsed.txt
  ```

  **Commit**: YES (Wave 1)
  - Message: `feat(config): add langfuse configuration schema`
  - Files: packages/coding-agent/src/config/schema.ts, packages/coding-agent/src/config/types.ts
  - Pre-commit: bun test src/config/schema.test.ts

- [ ] 3. 创建 packages/ai/telemetry 模块骨架

  **What to do**:
  - 创建 packages/ai/src/telemetry/ 目录
  - 创建 index.ts 导出公共 API
  - 创建 tracer.ts 初始化 OpenTelemetry SDK 和 LangfuseSpanProcessor
  - 创建 types.ts 定义 telemetry 相关类型
  - 创建 span-helpers.ts 提供创建/更新 span 的辅助函数
  - 编写单元测试验证初始化逻辑

  **Must NOT do**:
  - 不在此任务中添加实际埋点（只创建骨架）
  - 不硬编码 Langfuse 凭证（从配置读取）
  - 不阻塞主流程（初始化失败时静默降级）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 模块骨架创建，无需复杂埋点逻辑
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 1-2 并行）
  - **Parallel Group**: Wave 1 (with Tasks 1-2)
  - **Blocks**: Task 4
  - **Blocked By**: Task 1（依赖 @langfuse/otel）

  **References**:
  - Langfuse 官方文档: https://langfuse.com/docs/observability/get-started
  - `packages/ai/src/stream.ts` - 了解调用流程

  **Acceptance Criteria**:
  - [ ] packages/ai/src/telemetry/index.ts 存在并导出公共 API
  - [ ] packages/ai/src/telemetry/tracer.ts 初始化 NodeSDK 和 LangfuseSpanProcessor
  - [ ] packages/ai/src/telemetry/types.ts 定义 TelemetryConfig 类型
  - [ ] 单元测试通过：bun test telemetry/
  - [ ] 初始化函数接受 config 参数（enabled, secretKey, publicKey, baseUrl）

  **QA Scenarios**:
  ```
  Scenario: telemetry 模块初始化成功
    Tool: Bash
    Preconditions: telemetry 模块已创建
    Steps:
      1. cd packages/ai
      2. bun test src/telemetry/tracer.test.ts
      3. bun run -e "import { initTelemetry } from './src/telemetry'; console.log(typeof initTelemetry)"
    Expected Result: 测试通过，initTelemetry 是函数
    Failure Indicators: 导入失败，测试失败
    Evidence: .sisyphus/evidence/task-03-telemetry-init.txt
  ```

  **Commit**: YES (Wave 1)
  - Message: `feat(ai): add telemetry module skeleton`
  - Files: packages/ai/src/telemetry/**, packages/ai/src/index.ts (export telemetry)
  - Pre-commit: bun test src/telemetry/
- [ ] 4. packages/ai LLM 调用追踪

  **What to do**:
  - 在 packages/ai/src/stream.ts 的 stream() 函数中添加 span 创建
  - 创建 span 名称："llm-call"
  - 设置属性：gen_ai.request.model、gen_ai.request.provider、session.id（如有）
  - 在流式事件（start/text_delta/toolcall_delta/done）中更新 span
  - 在 done 事件中记录 usage（input_tokens、output_tokens、cache_read、cache_write、cost）
  - 在 error 事件中记录错误并结束 span
  - 编写集成测试验证追踪正确性

  **Must NOT do**:
  - 不修改现有事件流逻辑
  - 不阻塞流式响应（span 更新必须异步）
  - 不记录敏感的 API key

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要深入理解流式事件系统，多处埋点
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO（核心埋点，其他任务依赖此任务）
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 1, 3

  **References**:
  - `packages/ai/src/stream.ts:26-33` - stream() 函数入口
  - `packages/ai/src/providers/anthropic.ts:241-405` - 事件发射点
  - `packages/ai/src/providers/openai-responses-shared.ts:273-409` - OpenAI 事件处理
  - `packages/ai/src/models.ts:59-66` - calculateCost 函数

  **Acceptance Criteria**:
  - [ ] stream() 函数创建 span "llm-call"
  - [ ] span 属性包含 model、provider、session_id
  - [ ] done 事件记录 usage 和 cost
  - [ ] error 事件记录错误信息
  - [ ] 单元测试通过：bun test stream.test.ts
  - [ ] 集成测试通过：bun test telemetry/integration.test.ts

  **QA Scenarios**:
  ```
  Scenario: LLM 调用生成完整 span
    Tool: Bash
    Preconditions: telemetry 已初始化，Langfuse 配置有效
    Steps:
      1. cd packages/ai
      2. bun test src/telemetry/integration.test.ts
      3. 检查 mock Langfuse server 收到的 span
    Expected Result: span 包含 model、tokens、cost
    Failure Indicators: span 缺少属性，usage 为空
    Evidence: .sisyphus/evidence/task-04-llm-span.txt

  Scenario: 错误情况正确处理
    Tool: Bash
    Preconditions: API 调用失败
    Steps:
      1. 模拟 API 错误（无效 model）
      2. 检查 span 记录错误信息
    Expected Result: span 包含 error 属性
    Failure Indicators: span 未记录错误
    Evidence: .sisyphus/evidence/task-04-error-span.txt
  ```

  **Evidence to Capture**:
  - [ ] 集成测试输出显示 span 属性正确
  - [ ] Mock Langfuse server 收到完整 span

  **Commit**: YES (Wave 2)
  - Message: `feat(ai): add LLM call tracing`
  - Files: packages/ai/src/stream.ts, packages/ai/src/telemetry/**
  - Pre-commit: bun test src/stream.test.ts && bun test src/telemetry/

- [ ] 5. 创建 packages/coding-agent/telemetry 模块

  **What to do**:
  - 创建 packages/coding-agent/src/telemetry/ 目录
  - 创建 index.ts 导出公共 API
  - 创建 tracer.ts 初始化 OpenTelemetry（继承 packages/ai 的配置）
  - 创建 span-helpers.ts 提供 session/turn/tool span 创建辅助函数
  - 编写单元测试验证初始化逻辑

  **Must NOT do**:
  - 不重复初始化 OpenTelemetry（共享 packages/ai 的 SDK）
  - 不在此任务中添加实际埋点（只创建模块）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 模块骨架创建，与 Task 3 类似
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 4 并行）
  - **Parallel Group**: Wave 2 (with Tasks 4, 6-7)
  - **Blocks**: Tasks 6-7
  - **Blocked By**: Task 1

  **References**:
  - `packages/ai/src/telemetry/` - 参考实现
  - `packages/coding-agent/src/core/agent-session.ts` - 了解事件系统

  **Acceptance Criteria**:
  - [ ] packages/coding-agent/src/telemetry/index.ts 存在并导出公共 API
  - [ ] packages/coding-agent/src/telemetry/tracer.ts 提供获取 tracer 的函数
  - [ ] 单元测试通过：bun test telemetry/

  **QA Scenarios**:
  ```
  Scenario: telemetry 模块初始化成功
    Tool: Bash
    Preconditions: telemetry 模块已创建
    Steps:
      1. cd packages/coding-agent
      2. bun test src/telemetry/tracer.test.ts
    Expected Result: 测试通过
    Failure Indicators: 导入失败
    Evidence: .sisyphus/evidence/task-05-agent-telemetry.txt
  ```

  **Commit**: YES (Wave 2)
  - Message: `feat(coding-agent): add telemetry module`
  - Files: packages/coding-agent/src/telemetry/**
  - Pre-commit: bun test src/telemetry/

- [ ] 6. packages/coding-agent session/turn 追踪

  **What to do**:
  - 在 AgentSession 的 agent_start 事件中创建 session span
  - 在 turn_start 事件中创建 turn span（作为 session span 的子 span）
  - 在 turn_end 事件中结束 turn span
  - 在 agent_end 事件中结束 session span
  - 设置属性：session.id、turn.index、message count
  - 编写集成测试验证追踪层级正确

  **Must NOT do**:
  - 不修改现有事件发射逻辑
  - 不在 turn span 内部创建 llm-call span（已在 Task 4 处理）
  - 不阻塞主流程

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要理解 AgentSession 事件系统，多处埋点
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Tasks 4-5, 7 并行）
  - **Parallel Group**: Wave 2 (with Tasks 4-5, 7)
  - **Blocks**: Task 8
  - **Blocked By**: Task 5

  **References**:
  - `packages/coding-agent/src/core/agent-session.ts` - AgentSession 事件发射点
  - `packages/coding-agent/src/core/extensions/types.ts` - 事件类型定义

  **Acceptance Criteria**:
  - [ ] agent_start 创建 session span
  - [ ] turn_start 创建 turn span（parent: session span）
  - [ ] turn_end 结束 turn span
  - [ ] agent_end 结束 session span
  - [ ] span 属性包含 session.id、turn.index
  - [ ] 集成测试通过：bun test telemetry/session-tracking.test.ts

  **QA Scenarios**:
  ```
  Scenario: session/turn 层级正确
    Tool: Bash
    Preconditions: telemetry 已初始化
    Steps:
      1. cd packages/coding-agent
      2. bun test src/telemetry/session-tracking.test.ts
      3. 检查 mock server 收到的 span 层级
    Expected Result: session span → turn span（parent-child 关系）
    Failure Indicators: 层级错误，parent 缺失
    Evidence: .sisyphus/evidence/task-06-session-turn.txt
  ```

  **Commit**: YES (Wave 2)
  - Message: `feat(coding-agent): add session/turn tracing`
  - Files: packages/coding-agent/src/core/agent-session.ts, packages/coding-agent/src/telemetry/**
  - Pre-commit: bun test src/telemetry/

- [ ] 7. packages/coding-agent tool execution 追踪

  **What to do**:
  - 在 tool_execution_start 事件中创建 tool span（作为 turn span 的子 span）
  - 在 tool_execution_update 事件中更新 tool span（添加 partial result）
  - 在 tool_execution_end 事件中结束 tool span（记录 result 和 duration）
  - 设置属性：tool.name、tool.arguments、tool.duration、tool.result_preview
  - 编写集成测试验证工具追踪正确性

  **Must NOT do**:
  - 不记录完整的 tool result（只记录 preview，避免过大）
  - 不修改现有工具执行逻辑
  - 不阻塞主流程

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要理解工具执行流程，多处埋点
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Tasks 4-6 并行）
  - **Parallel Group**: Wave 2 (with Tasks 4-6)
  - **Blocks**: Task 8
  - **Blocked By**: Task 5

  **References**:
  - `packages/coding-agent/src/core/extensions/runner.ts` - 工具执行事件发射点
  - `packages/coding-agent/src/core/extensions/types.ts` - ToolExecutionStartEvent/EndEvent

  **Acceptance Criteria**:
  - [ ] tool_execution_start 创建 tool span（parent: turn span）
  - [ ] tool_execution_end 结束 tool span
  - [ ] span 属性包含 tool.name、tool.duration
  - [ ] 集成测试通过：bun test telemetry/tool-tracking.test.ts

  **QA Scenarios**:
  ```
  Scenario: tool execution 追踪正确
    Tool: Bash
    Preconditions: telemetry 已初始化
    Steps:
      1. cd packages/coding-agent
      2. bun test src/telemetry/tool-tracking.test.ts
      3. 检查 mock server 收到的 tool span
    Expected Result: tool span 包含 name、duration、parent（turn span）
    Failure Indicators: 缺少属性，parent 错误
    Evidence: .sisyphus/evidence/task-07-tool-execution.txt
  ```

  **Commit**: YES (Wave 2)
  - Message: `feat(coding-agent): add tool execution tracing`
  - Files: packages/coding-agent/src/core/extensions/runner.ts, packages/coding-agent/src/telemetry/**
  - Pre-commit: bun test src/telemetry/
- [ ] 8. 集成测试（完整调用链）

  **What to do**:
  - 创建端到端集成测试：模拟完整 agent 调用流程
  - 测试流程：session start → turn start → llm call → tool execution → turn end → session end
  - 验证 span 层级关系正确（parent-child）
  - 验证所有 span 属性完整（model、tokens、cost、tool name）
  - 使用 mock Langfuse server 验证上报数据
  - 编写测试文档说明如何运行集成测试

  **Must NOT do**:
  - 不使用真实 Langfuse 凭证（使用 mock server）
  - 不跳过任何层级验证
  - 不忽略错误情况

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要深入理解整个调用链，编写复杂集成测试
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO（依赖所有埋点完成）
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 4, 6, 7

  **References**:
  - `packages/ai/src/telemetry/` - LLM 追踪实现
  - `packages/coding-agent/src/telemetry/` - Agent 追踪实现

  **Acceptance Criteria**:
  - [ ] 集成测试文件存在：packages/coding-agent/test/telemetry/e2e.test.ts
  - [ ] 测试覆盖完整调用链（session → turn → llm → tool）
  - [ ] 验证 span 层级关系正确
  - [ ] 验证所有 span 属性完整
  - [ ] 测试通过：bun test telemetry/e2e.test.ts

  **QA Scenarios**:
  ```
  Scenario: 完整调用链追踪正确
    Tool: Bash
    Preconditions: 所有埋点已完成
    Steps:
      1. cd packages/coding-agent
      2. bun test test/telemetry/e2e.test.ts
      3. 检查 mock server 收到的完整 trace
    Expected Result: trace 包含所有层级，属性完整
    Failure Indicators: 缺少层级，属性不完整
    Evidence: .sisyphus/evidence/task-08-e2e-trace.txt
  ```

  **Commit**: YES (Wave 3)
  - Message: `test(telemetry): add e2e integration test`
  - Files: packages/coding-agent/test/telemetry/e2e.test.ts
  - Pre-commit: bun test test/telemetry/e2e.test.ts

- [ ] 9. 配置文件加载和验证

  **What to do**:
  - 在 packages/coding-agent/src/config/loader.ts 添加 langfuse 配置加载逻辑
  - 验证配置格式（enabled、secretKey、publicKey、baseUrl）
  - 当 enabled=false 时不初始化 telemetry
  - 当配置无效时输出警告并降级（不阻塞启动）
  - 编写单元测试验证各种配置情况

  **Must NOT do**:
  - 不在配置无效时抛出错误（只警告）
  - 不硬编码默认凭证
  - 不验证凭证有效性（只验证格式）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的配置加载和验证逻辑
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 8 并行）
  - **Parallel Group**: Wave 3 (with Tasks 8, 10-11)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 2

  **References**:
  - `packages/coding-agent/src/config/schema.ts` - langfuse schema 定义
  - `packages/coding-agent/src/config/loader.ts` - 现有配置加载逻辑

  **Acceptance Criteria**:
  - [ ] config loader 加载 langfuse 配置
  - [ ] enabled=false 时不初始化 telemetry
  - [ ] 配置无效时输出警告并继续
  - [ ] 单元测试通过：bun test config/loader.test.ts

  **QA Scenarios**:
  ```
  Scenario: 配置禁用时不初始化
    Tool: Bash
    Preconditions: config.langfuse.enabled = false
    Steps:
      1. cd packages/coding-agent
      2. bun test src/config/loader.test.ts
      3. 检查 telemetry 未初始化
    Expected Result: telemetry 未初始化，无错误
    Failure Indicators: telemetry 初始化或错误
    Evidence: .sisyphus/evidence/task-09-config-disabled.txt

  Scenario: 配置无效时降级
    Tool: Bash
    Preconditions: config.langfuse.secretKey 格式错误
    Steps:
      1. cd packages/coding-agent
      2. bun test src/config/loader.test.ts
      3. 检查输出警告
    Expected Result: 警告输出，程序继续
    Failure Indicators: 抛出错误或崩溃
    Evidence: .sisyphus/evidence/task-09-config-invalid.txt
  ```

  **Commit**: YES (Wave 3)
  - Message: `feat(config): add langfuse config loading`
  - Files: packages/coding-agent/src/config/loader.ts
  - Pre-commit: bun test src/config/

- [ ] 10. 错误处理和降级策略

  **What to do**:
  - 在 telemetry 初始化失败时降级（不阻塞启动）
  - 在 span 创建失败时降级（不影响主流程）
  - 在 Langfuse 上报失败时记录错误并继续
  - 添加重试逻辑（对临时网络错误）
  - 编写单元测试验证各种错误情况

  **Must NOT do**:
  - 不在错误时阻塞主流程
  - 不无限重试（设置最大重试次数）
  - 不记录敏感信息到错误日志

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要考虑多种错误场景，编写健壮的降级逻辑
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Tasks 8-9, 11 并行）
  - **Parallel Group**: Wave 3 (with Tasks 8-9, 11)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 1-3

  **References**:
  - `packages/ai/src/telemetry/tracer.ts` - 初始化逻辑
  - `packages/coding-agent/src/telemetry/tracer.ts` - 初始化逻辑

  **Acceptance Criteria**:
  - [ ] telemetry 初始化失败时降级
  - [ ] span 创建失败时降级
  - [ ] Langfuse 上报失败时记录错误并继续
  - [ ] 重试逻辑实现（最大 3 次）
  - [ ] 单元测试通过：bun test telemetry/error-handling.test.ts

  **QA Scenarios**:
  ```
  Scenario: 初始化失败降级
    Tool: Bash
    Preconditions: Langfuse SDK 初始化失败
    Steps:
      1. cd packages/ai
      2. bun test src/telemetry/error-handling.test.ts
      3. 检查降级日志
    Expected Result: 程序继续，无 span 创建
    Failure Indicators: 程序崩溃或阻塞
    Evidence: .sisyphus/evidence/task-10-init-failure.txt

  Scenario: 上报失败重试
    Tool: Bash
    Preconditions: Langfuse server 不可达
    Steps:
      1. cd packages/ai
      2. bun test src/telemetry/error-handling.test.ts
      3. 检查重试次数
    Expected Result: 重试 3 次后记录错误
    Failure Indicators: 无限重试或立即失败
    Evidence: .sisyphus/evidence/task-10-upload-retry.txt
  ```

  **Commit**: YES (Wave 3)
  - Message: `feat(telemetry): add error handling and degradation`
  - Files: packages/ai/src/telemetry/tracer.ts, packages/coding-agent/src/telemetry/tracer.ts
  - Pre-commit: bun test src/telemetry/error-handling.test.ts

- [ ] 11. 文档更新（README、CHANGELOG）

  **What to do**:
  - 在 packages/ai/README.md 添加 telemetry 使用说明
  - 在 packages/coding-agent/README.md 添加 Langfuse 配置说明
  - 在 packages/ai/CHANGELOG.md 添加 [Unreleased] 条目
  - 在 packages/coding-agent/CHANGELOG.md 添加 [Unreleased] 条目
  - 文档包括：功能介绍、配置方法、使用示例、故障排查

  **Must NOT do**:
  - 不添加不必要的截图或 GIF
  - 不重复已有文档内容
  - 不使用 emoji（遵守项目规范）

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: 技术文档编写
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Tasks 8-10 并行）
  - **Parallel Group**: Wave 3 (with Tasks 8-10)
  - **Blocks**: F1-F4
  - **Blocked By**: All previous tasks

  **References**:
  - `packages/ai/README.md` - 现有 README 结构
  - `packages/ai/CHANGELOG.md` - 现有 CHANGELOG 格式
  - `packages/coding-agent/README.md` - 现有 README 结构
  - `packages/coding-agent/CHANGELOG.md` - 现有 CHANGELOG 格式

  **Acceptance Criteria**:
  - [ ] packages/ai/README.md 包含 telemetry 使用说明
  - [ ] packages/coding-agent/README.md 包含 Langfuse 配置说明
  - [ ] packages/ai/CHANGELOG.md 包含 [Unreleased] 条目
  - [ ] packages/coding-agent/CHANGELOG.md 包含 [Unreleased] 条目
  - [ ] 文档格式符合项目规范（无 emoji）

  **QA Scenarios**:
  ```
  Scenario: 文档格式正确
    Tool: Bash
    Preconditions: 文档已更新
    Steps:
      1. grep -E "[\u{1F300}-\u{1F9FF}]" packages/ai/README.md
      2. grep -E "[\u{1F300}-\u{1F9FF}]" packages/coding-agent/README.md
      3. 检查 CHANGELOG 格式
    Expected Result: 无 emoji，CHANGELOG 格式正确
    Failure Indicators: 发现 emoji 或格式错误
    Evidence: .sisyphus/evidence/task-11-docs.txt
  ```

  **Commit**: YES (Wave 3)
  - Message: `docs: add langfuse telemetry documentation`
  - Files: packages/ai/README.md, packages/ai/CHANGELOG.md, packages/coding-agent/README.md, packages/coding-agent/CHANGELOG.md
  - Pre-commit: none


- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together, not isolation). Test edge cases: config disabled, invalid credentials, network failure. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `feat(telemetry): add langfuse dependencies and config schema` — package.json, config schema files
- **Wave 2**: `feat(telemetry): add LLM and agent tracing` — packages/ai/telemetry, packages/coding-agent/telemetry
- **Wave 3**: `feat(telemetry): add integration tests and docs` — tests, README, CHANGELOG

---

## Success Criteria

### Verification Commands
```bash
# 1. 验证依赖安装
bun pm ls | grep -E "@langfuse|@opentelemetry"

# 2. 验证配置文件 schema
cat packages/coding-agent/src/config/schema.ts | grep -A 10 "langfuse"

# 3. 验证 telemetry 模块存在
test -f packages/ai/src/telemetry/index.ts && echo "✅ packages/ai/telemetry exists"
test -f packages/coding-agent/src/telemetry/index.ts && echo "✅ packages/coding-agent/telemetry exists"

# 4. 运行测试
cd packages/ai && bun test telemetry
cd packages/coding-agent && bun test telemetry

# 5. 验证追踪功能（需要 Langfuse 凭证）
# 配置 langfuse.enabled = true
# 运行 pi，检查 Langfuse dashboard 是否收到 traces
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Documentation updated
- [ ] No performance regression
- [ ] Existing logs unaffected
