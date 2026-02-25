# Mom Slack 命令处理探索

## 1. Stop 命令实现

### 1.1 触发位置

**slack.ts** 中有两处处理 stop 命令:

- **app_mention 事件** (行 338-346): 当用户在频道 @mention bot 时触发
- **message 事件** (行 417-425): 当用户发送 DM 时触发

```typescript
// 检查 stop 命令 - 立即执行，不入队!
if (slackEvent.text.toLowerCase().trim() === "stop") {
    if (this.handler.isRunning(e.channel)) {
        this.handler.handleStop(e.channel, this);  // 不 await，不入队
    } else {
        this.postMessage(e.channel, "_Nothing running_");
    }
    ack();
    return;
}
```

### 1.2 handleStop 实现 (main.ts 行 305-315)

```typescript
async handleStop(channelId: string, slack: SlackBot): Promise<void> {
    const state = channelStates.get(channelId);
    if (state?.running) {
        state.stopRequested = true;
        state.runner.abort();  // 中止 agent
        const ts = await slack.postMessage(channelId, "_Stopping..._");
        state.stopMessageTs = ts;
    } else {
        await slack.postMessage(channelId, "_Nothing running_");
    }
}
```

### 1.3 Runner.abort() 实现 (agent.ts 行 940-942)

```typescript
abort(): void {
    session.abort();  // 调用 pi-agent-core 的 abort
}
```

---

## 2. 消息队列机制

### 2.1 ChannelQueue 类 (slack.ts 行 101-126)

```typescript
class ChannelQueue {
    private queue: QueuedWork[] = [];
    private processing = false;

    enqueue(work: QueuedWork): void {
        this.queue.push(work);
        this.processNext();
    }

    private async processNext(): Promise<void> {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;
        const work = this.queue.shift()!;
        try {
            await work();
        } catch (err) {
            slackLog.warning("Queue error", err instanceof Error ? err.message : String(err));
        }
        this.processing = false;
        this.processNext();  // 链式处理
    }
}
```

### 2.2 getQueue (slack.ts 行 289-296)

```typescript
private getQueue(channelId: string): ChannelQueue {
    let queue = this.queues.get(channelId);
    if (!queue) {
        queue = new ChannelQueue();
        this.queues.set(channelId, queue);
    }
    return queue;
}
```

### 2.3 enqueueEvent (slack.ts 行 274-283)

```typescript
enqueueEvent(event: SlackEvent): boolean {
    const queue = this.getQueue(event.channel);
    if (queue.size() >= 5) {  // 每频道最多 5 个事件
        slackLog.warning(`Event queue full for ${event.channel}`);
        return false;
    }
    queue.enqueue(() => this.handler.handleEvent(event, this, true));
    return true;
}
```

---

## 3. getOrCreateRunner

### 3.1 定义 (agent.ts 行 386-393)

```typescript
// 缓存每个频道的 runner
const channelRunners = new Map<string, AgentRunner>();

export function getOrCreateRunner(
    sandboxConfig: SandboxConfig, 
    channelId: string, 
    channelDir: string
): AgentRunner {
    const existing = channelRunners.get(channelId);
    if (existing) return existing;

    const runner = createRunner(sandboxConfig, channelId, channelDir);
    channelRunners.set(channelId, runner);
    return runner;
}
```

### 3.2 createRunner (agent.ts 行 399-944)

创建 runner 时会:
1. 创建 executor (sandbox)
2. 创建工具 (bash, read, write, edit, attach)
3. 加载 memory 和 skills
4. 创建 SessionManager
5. 创建 Agent 实例
6. 订阅事件 (tool execution, message, etc.)
7. 返回 `{ run(), abort() }` 接口

---

## 4. Slack 消息发送 API

### 4.1 核心方法 (slack.ts)

| 方法 | 行号 | 说明 |
|------|------|------|
| `postMessage(channel, text)` | 194-197 | 发送普通消息 |
| `postMessageBlocks(channel, text, blocks)` | 199-202 | 发送 Block Kit 消息 |
| `postInThread(channel, threadTs, text)` | 216-219 | 在线程中回复 |
| `postInThreadBlocks(channel, threadTs, text, blocks)` | 221-229 | 在线程中发送 Block Kit |
| `updateMessage(channel, ts, text)` | 204-206 | 更新消息 |
| `updateMessageBlocks(channel, ts, text, blocks)` | 208-210 | 更新 Block Kit 消息 |
| `deleteMessage(channel, ts)` | 212-214 | 删除消息 |
| `uploadFile(channel, filePath, title?)` | 231-240 | 上传文件 |

### 4.2 使用方式

所有方法使用 `webClient.chat.*` API:
```typescript
const result = await this.webClient.chat.postMessage({ channel, text });
```

---

## 5. 事件处理流程

### 5.1 入口点

1. **Socket Mode 监听**: `socketClient.on("app_mention", ...)` 和 `socketClient.on("message", ...)`

2. **ack() 调用时机** (非常重要!):
   - 每个事件处理器结束前必须调用 `ack()` 确认
   - 在 stop 命令处理后立即调用
   - 在消息被忽略(过期的、bot消息等)时也要调用
   - 如果不 ack，Slack 会重试投递

3. **消息处理流程**:
   ```
   收到 Slack 事件
        ↓
   logUserMessage() - 同步写入 log.jsonl
        ↓
   检查 stop 命令 → handleStop (立即执行)
        ↓
   检查 isRunning() → 
     - running: 返回 "Already working"
     - not running: getQueue().enqueue() → handleEvent()
   ```

### 5.2 事件分类

- **app_mention**: 频道中 @mention bot
- **message (channel)**: 频道消息 (用于日志)
- **message (im)**: 私信/DM (触发处理)

---

## 6. 频道级别隔离机制

### 6.1 状态隔离

**main.ts** 中的 `channelStates` Map:
```typescript
const channelStates = new Map<string, ChannelState>();

interface ChannelState {
    running: boolean;
    runner: AgentRunner;
    store: ChannelStore;
    stopRequested: boolean;
    stopMessageTs?: string;
}
```

### 6.2 Runner 缓存

- `channelRunners` Map (agent.ts): 每个频道一个 AgentRunner 实例
- Runner 持久化: 跨消息复用，包含完整的 session 状态

### 6.3 Queue 隔离

- `queues` Map (slack.ts): 每个频道一个 ChannelQueue
- 确保同一频道的消息串行处理

### 6.4 存储隔离

- 每个频道有独立的目录: `<workingDir>/<channelId>/`
- 独立的 log.jsonl, context.jsonl, MEMORY.md, attachments/

---

## 7. 关键发现

1. **stop 命令不 await**: 立即调用 `handleStop`，不等待完成
2. **stop 命令不入队**: 直接执行，不通过 ChannelQueue
3. **ack() 必须在所有路径调用**: 遗漏会导致 Slack 重试
4. **队列限制**: 每频道最多 5 个待处理事件
5. **Runner 缓存**: AgentRunner 跨会话缓存，保留上下文
