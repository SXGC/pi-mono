# Mom 对话队列功能

## TL;DR

> **Quick Summary**: 为 mom 添加消息队列功能，当对话正在进行时，新消息入队等待而非显示 "Already working"。入队时发送等待提示到用户消息的线程中。
> 
> **Deliverables**:
> - 修改 `slack.ts` 中的消息处理逻辑
> - 新增单元测试验证队列行为
> 
> **Estimated Effort**: Short
> **Parallel Execution**: NO - 顺序实现
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4

---

## Context

### Original Request
> 当前已经有对话正在进行时，用户又发送一个消息，此时将这个消息放入队列，等待已有任务完成在进行。
> 放入队列后，发送一个 waiting 之类的提示消息到这个消息的 thread 中

### Interview Summary
**Key Discussions**:
- **Waiting 提示时机**: 入队时立即发送
- **Waiting 提示内容**: `"_Queued. Will respond when current task finishes._"`
- **队列持久化**: 内存队列（重启丢失）
- **取消队列**: 不需要
- **队列满行为**: 发送 `"_Queue full. Please wait and try again._"`
- **Stop 行为**: 只停止当前任务，不清空队列
- **测试策略**: TDD

**Research Findings**:
- `ChannelQueue` 类已存在于 `slack.ts:154-179`
- `postInThread(channel, threadTs, text)` 可用于发送线程消息
- `slackEvent.ts` 包含用户消息时间戳，可用作 `threadTs`
- 两处需要修改: `slack.ts:502-511` 和 `slack.ts:626-636`

### Metis Review
**Identified Gaps** (addressed):
- 队列满时的行为: 发送错误消息
- Stop 命令行为: 只停止当前任务
- 边缘情况: DM 场景、带附件消息、等待提示发送失败

---

## Work Objectives

### Core Objective
修改 mom 的消息处理逻辑，将 "Already working" 行为替换为队列机制，并在入队时发送等待提示。

### Concrete Deliverables
- `packages/mom/src/slack.ts`: 修改消息处理逻辑
- `packages/mom/test/queue.test.ts`: 新增单元测试

### Definition of Done
- [x] `pnpm check` 通过 (lint + typecheck)
- [x] 单元测试覆盖核心场景
- [ ] 手动测试验证 Slack 行为

### Must Have
- 入队时发送等待提示到用户消息线程
- 队列满时发送错误消息
- 保持现有 stop 命令行为不变

### Must NOT Have (Guardrails)
- 不修改 `ChannelQueue` 类
- 不修改 stop 命令行为
- 不修改内置命令处理逻辑
- 不添加队列持久化
- 不添加队列位置显示
- 不添加队列取消功能

---

## Verification Strategy (MANDATORY)

### Test Decision
- **Infrastructure exists**: YES (vitest)
- **Automated tests**: TDD
- **Framework**: vitest

### QA Policy
Every task MUST include agent-executed QA scenarios.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation - Tests First):
├── Task 1: Write failing tests for queue behavior [quick]
└── Task 2: Write failing tests for waiting prompt [quick]

Wave 2 (Implementation):
├── Task 3: Implement enqueueUserMessage helper [quick]
├── Task 4: Modify app_mention handler [quick]
└── Task 5: Modify message handler [quick]

Wave 3 (Verification):
├── Task 6: Run all tests and verify [quick]
└── Task 7: Manual QA via Slack [unspecified-high]
```

### Dependency Matrix

- **1-2**: — — 6
- **3**: — 4, 5
- **4**: 3 — 6
- **5**: 3 — 6
- **6**: 1, 2, 4, 5 — 7
- **7**: 6 — F1-F4

### Agent Dispatch Summary

- **1-2**: quick (tests)
- **3-5**: quick (implementation)
- **6**: quick (verification)
- **7**: unspecified-high (manual QA)

---

## TODOs

- [x] 1. Write failing tests for queue behavior

  **What to do**:
  - Create `packages/mom/test/queue.test.ts`
  - Test case: When isRunning is true, message should be enqueued
  - Test case: When queue is full (5 items), error message should be sent
  - Test case: Enqueued messages should be processed in order

  **Must NOT do**:
  - Do not test implementation details
  - Do not mock more than necessary

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple test file creation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Task 6
  - **Blocked By**: None

  **References**:
  - `packages/mom/src/slack.ts:154-179` - ChannelQueue class pattern
  - `packages/mom/src/slack.ts:341-350` - enqueueEvent pattern
  - `packages/mom/test/*.test.ts` - Existing test patterns

  **Acceptance Criteria**:
  - [x] Test file created: `packages/mom/test/queue.test.ts`
  - [x] `npx vitest run test/queue.test.ts` → FAIL (expected, TDD)

  **QA Scenarios**:
  ```
  Scenario: Tests run and fail as expected (TDD RED phase)
    Tool: Bash
    Steps:
      1. cd packages/mom && npx vitest run test/queue.test.ts
    Expected Result: Tests fail with clear error messages
    Failure Indicators: Tests pass (wrong - should fail in TDD)
    Evidence: .sisyphus/evidence/task-1-tdd-red.txt
  ```

  **Commit**: NO (groups with Task 2)

- [x] 2. Write failing tests for waiting prompt

  **What to do**:
  - Add to `packages/mom/test/queue.test.ts`
  - Test case: Waiting prompt sent to user message thread
  - Test case: Waiting prompt content is correct
  - Test case: Queue full error message content

  **Must NOT do**:
  - Do not test UI styling
  - Do not test Slack API directly

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Adding test cases
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 6
  - **Blocked By**: None

  **References**:
  - `packages/mom/src/slack.ts:283-296` - postInThread implementation
  - `packages/mom/src/slack.ts:503-508` - Current "Already working" message

  **Acceptance Criteria**:
  - [x] Tests added for waiting prompt behavior
  - [x] Tests added for queue full error
  - [x] `npx vitest run test/queue.test.ts` → FAIL (expected, TDD)

  **QA Scenarios**:
  ```
  Scenario: All new tests fail as expected (TDD RED phase)
    Tool: Bash
    Steps:
      1. cd packages/mom && npx vitest run test/queue.test.ts
    Expected Result: All tests fail with clear error messages
    Failure Indicators: Any test passes (wrong in TDD)
    Evidence: .sisyphus/evidence/task-2-tdd-red.txt
  ```

  **Commit**: YES
  - Message: `test(mom): add failing tests for message queue feature`
  - Files: `packages/mom/test/queue.test.ts`
  - Pre-commit: `cd packages/mom && npx vitest run test/queue.test.ts` (expect failure)

- [x] 3. Implement enqueueUserMessage helper

  **What to do**:
  - Add new method to SlackBot class in `slack.ts`
  - Method signature: `enqueueUserMessage(slackEvent: SlackEvent): void`
  - Logic:
    1. Check queue size, if >= 5: post error message and return
    2. Post waiting prompt to user message thread: `postInThread(channel, slackEvent.ts, "_Queued. Will respond when current task finishes._")`
    3. Enqueue the message for processing

  **Must NOT do**:
  - Do not modify ChannelQueue class
  - Do not add persistence
  - Do not change stop behavior

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single method addition
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 4, Task 5
  - **Blocked By**: Task 2

  **References**:
  - `packages/mom/src/slack.ts:154-179` - ChannelQueue class
  - `packages/mom/src/slack.ts:283-296` - postInThread method
  - `packages/mom/src/slack.ts:341-350` - enqueueEvent pattern

  **Acceptance Criteria**:
  - [x] Method `enqueueUserMessage` added to SlackBot class
  - [x] Queue size check implemented (max 5)
  - [x] Waiting prompt sent to thread
  - [x] TypeScript compiles without errors

  **QA Scenarios**:
  ```
  Scenario: Helper method compiles and follows existing patterns
    Tool: Bash
    Steps:
      1. cd packages/mom && pnpm exec tsc --noEmit
    Expected Result: No type errors
    Failure Indicators: TypeScript compilation errors
    Evidence: .sisyphus/evidence/task-3-compile.txt
  ```

  **Commit**: NO (groups with Task 4, 5)

- [x] 4. Modify app_mention handler

  **What to do**:
  - Modify `slack.ts:502-511` (isRunning check in app_mention handler)
  - Replace: `this.postMessage(channel, "_Already working..._")`
  - With: `this.enqueueUserMessage(slackEvent)`

  **Must NOT do**:
  - Do not modify stop command handling
  - Do not modify builtin command handling
  - Do not change message logging behavior

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small modification to existing code
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (depends on Task 3)
  - **Blocks**: Task 6
  - **Blocked By**: Task 3

  **References**:
  - `packages/mom/src/slack.ts:416-514` - Full app_mention handler
  - `packages/mom/src/slack.ts:502-511` - Specific isRunning check to modify

  **Acceptance Criteria**:
  - [x] `app_mention` handler uses `enqueueUserMessage` instead of posting "Already working"
  - [x] Stop command handling unchanged
  - [x] Builtin command handling unchanged

  **QA Scenarios**:
  ```
  Scenario: Code change is minimal and correct
    Tool: Bash
    Steps:
      1. git diff packages/mom/src/slack.ts | grep -A5 -B5 "enqueueUserMessage"
    Expected Result: Shows clean replacement of "Already working" logic
    Failure Indicators: Large diff or changes to unrelated code
    Evidence: .sisyphus/evidence/task-4-diff.txt
  ```

  **Commit**: NO (groups with Task 3, 5)

- [x] 5. Modify message handler

  **What to do**:
  - Modify `slack.ts:626-636` (isRunning check in message handler)
  - Replace: `this.postMessage(channel, "_Already working..._")`
  - With: `this.enqueueUserMessage(slackEvent)`
  - Note: DM messages use different cancel hint, preserve this behavior

  **Must NOT do**:
  - Do not modify stop command handling
  - Do not modify builtin command handling
  - Do not change DM vs channel distinction

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small modification to existing code
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (depends on Task 3)
  - **Blocks**: Task 6
  - **Blocked By**: Task 3

  **References**:
  - `packages/mom/src/slack.ts:517-639` - Full message handler
  - `packages/mom/src/slack.ts:626-636` - Specific isRunning check to modify

  **Acceptance Criteria**:
  - [x] `message` handler uses `enqueueUserMessage` instead of posting "Already working"
  - [x] Stop command handling unchanged
  - [x] Builtin command handling unchanged
  - [x] DM vs channel distinction preserved

  **QA Scenarios**:
  ```
  Scenario: Code change is minimal and correct
    Tool: Bash
    Steps:
      1. git diff packages/mom/src/slack.ts | grep -A5 -B5 "enqueueUserMessage"
    Expected Result: Shows clean replacement in message handler too
    Failure Indicators: Changes to stop command or DM logic
    Evidence: .sisyphus/evidence/task-5-diff.txt
  ```

  **Commit**: YES
  - Message: `feat(mom): add message queue for busy state`
  - Files: `packages/mom/src/slack.ts`
  - Pre-commit: `cd packages/mom && pnpm exec tsc --noEmit && npx vitest run test/queue.test.ts`

- [x] 6. Run all tests and verify

  **What to do**:
  - Run `npx vitest run test/queue.test.ts`
  - Verify all tests pass (TDD GREEN phase)
  - Run `pnpm check` to ensure lint and typecheck pass

  **Must NOT do**:
  - Do not skip failing tests
  - Do not modify tests to make them pass

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Test verification
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 7
  - **Blocked By**: Task 1, 2, 4, 5

  **References**:
  - `packages/mom/test/queue.test.ts` - Tests to run

  **Acceptance Criteria**:
  - [x] `npx vitest run test/queue.test.ts` → PASS (all tests)
  - [x] `pnpm check` → PASS (no errors)

  **QA Scenarios**:
  ```
  Scenario: All tests pass (TDD GREEN phase)
    Tool: Bash
    Steps:
      1. cd packages/mom && npx vitest run test/queue.test.ts
    Expected Result: All tests pass
    Failure Indicators: Any test failure
    Evidence: .sisyphus/evidence/task-6-tests-pass.txt

  Scenario: Code quality checks pass
    Tool: Bash
    Steps:
      1. cd /Users/cai/Dev/pi-mono && pnpm check
    Expected Result: No errors, warnings, or infos
    Failure Indicators: Any lint/typecheck errors
    Evidence: .sisyphus/evidence/task-6-check-pass.txt
  ```

  **Commit**: NO (code already committed in Task 5)

- [ ] 7. Manual QA via Slack

  **What to do**:
  - Start mom in dev mode
  - Send first message to trigger a long-running task
  - Send second message while first is running
  - Verify waiting prompt appears in thread
  - Wait for first task to complete
  - Verify second message is processed
  - Test queue full scenario (send 6 messages)

  **Must NOT do**:
  - Do not commit without manual verification
  - Do not skip queue full test

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Requires careful manual testing
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Final verification
  - **Blocked By**: Task 6

  **References**:
  - `packages/mom/README.md:507-519` - Dev mode instructions

  **Acceptance Criteria**:
  - [ ] Waiting prompt appears in user message thread
  - [ ] Waiting prompt content: `"_Queued. Will respond when current task finishes._"`
  - [ ] Queued messages processed in order after current task completes
  - [ ] Queue full message: `"_Queue full. Please wait and try again._"`
  - [ ] Stop command only stops current task, not queue

  **QA Scenarios**:
  ```
  Scenario: Queue behavior in channel
    Tool: Manual (Slack UI)
    Preconditions: mom running in dev mode
    Steps:
      1. Send "@mom list all files in /workspace" (triggers long task)
      2. Immediately send "@mom what time is it"
      3. Check that waiting prompt appears in thread of message 2
      4. Wait for first task to complete
      5. Verify second message is processed
    Expected Result: 
      - Waiting prompt: "_Queued. Will respond when current task finishes._"
      - Second message processed after first completes
    Evidence: .sisyphus/evidence/task-7-channel-qa.png (screenshot)

  Scenario: Queue full behavior
    Tool: Manual (Slack UI)
    Preconditions: mom running, queue has 5 messages
    Steps:
      1. Send 6th message
    Expected Result: "_Queue full. Please wait and try again._"
    Evidence: .sisyphus/evidence/task-7-queue-full.png (screenshot)

  Scenario: Stop command does not clear queue
    Tool: Manual (Slack UI)
    Preconditions: mom processing task, queue has messages
    Steps:
      1. Send "stop"
      2. Wait for current task to stop
      3. Verify queued messages still process
    Expected Result: Only current task stops, queue continues
    Evidence: .sisyphus/evidence/task-7-stop-behavior.png (screenshot)
  ```

  **Commit**: YES (if manual QA passes)
  - Message: `docs(mom): update CHANGELOG for queue feature`
  - Files: `packages/mom/CHANGELOG.md`
  - Pre-commit: None

---

## Final Verification Wave (MANDATORY)

- [x] F1. **Plan Compliance Audit** — `oracle`
  - [x] F2. **Code Quality Review** — `unspecified-high`
  - [x] F3. **Real Manual QA** — `unspecified-high`
  - [x] F4. **Scope Fidelity Check** — `deep`
  Run `pnpm check`, review for AI slop patterns.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Execute all QA scenarios from Task 7, capture evidence.
  Output: `Scenarios [N/N pass] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  Verify no scope creep, all changes match spec.
  Output: `Tasks [N/N compliant] | VERDICT`

---

## Commit Strategy

- **Task 2**: `test(mom): add failing tests for message queue feature` — packages/mom/test/queue.test.ts
- **Task 5**: `feat(mom): add message queue for busy state` — packages/mom/src/slack.ts
- **Task 7**: `docs(mom): update CHANGELOG for queue feature` — packages/mom/CHANGELOG.md

---

## Success Criteria

### Verification Commands
```bash
cd packages/mom && npx vitest run test/queue.test.ts  # Expected: all tests pass
pnpm check  # Expected: no errors
```

- [x] All "Must have" present
- [x] All "Must NOT Have" absent
- [x] All tests pass
- [ ] Manual QA verified
- [ ] Manual QA verified
