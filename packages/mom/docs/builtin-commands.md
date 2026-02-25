# Builtin Commands Architecture

This document describes how builtin commands (like `/model` and `/new`) are implemented and shared between `pi-coding-agent` and `mom`.

## Overview

Both `pi-coding-agent` (interactive TUI) and `mom` (Slack bot) support a set of builtin slash commands. The architecture uses a **runtime injection pattern** to keep command logic UI-agnostic.

## Supported Commands

| Command | Description |
|---------|-------------|
| `/model [provider/modelId]` | Display or switch the current model |
| `/new` | Start a new session (archive current) |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              coding-agent                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  slash-commands.ts        command-parser.ts       command-dispatcher.ts     │
│  ┌───────────────────┐    ┌──────────────────┐    ┌─────────────────────┐   │
│  │ BUILTIN_SLASH_    │    │ parseSlashCommand│    │ BuiltinCommandRuntime│   │
│  │ COMMANDS: [       │    │ isBuiltinCommand │    │ BuiltinCommandResult │   │
│  │   "model",        │───▶│                  │───▶│ tryBuiltinCommand()  │   │
│  │   "new",          │    │                  │    │ handleModelCommand() │   │
│  │   "settings",     │    │                  │    │ handleNewCommand()   │   │
│  │   ...             │    │                  │    │                      │   │
│  │ ]                 │    └──────────────────┘    └─────────────────────┘   │
│  └───────────────────┘                            │                         │
│                                                   ▼                         │
│                                          model-matcher.ts                   │
│                                          ┌─────────────────┐                │
│                                          │ findExactModel  │                │
│                                          │ findModel       │                │
│                                          │ Candidates      │                │
│                                          │ formatModel     │                │
│                                          │ formatModel     │                │
│                                          │ NotFound        │                │
│                                          └─────────────────┘                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Public API
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              @mariozechner/pi-coding-agent                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Exported from index.ts:                                                      │
│  - BuiltinCommandRuntime (interface)                                         │
│  - BuiltinCommandResult (interface)                                          │
│  - tryBuiltinCommand (function)                                              │
│  - findExactModelMatch (function)                                            │
│  - findModelCandidates (function)                                            │
│  - formatModelStatus (function)                                              │
│  - formatModelNotFound (function)                                            │
│  - parseSlashCommand (function)                                              │
│  - isBuiltinCommand (function)                                               │
                                    │
                                    │ Import
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                  mom                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  agent.ts imports from @mariozechner/pi-coding-agent:                         │
│  - tryBuiltinCommand                                                         │
│  - type BuiltinCommandRuntime                                                │
│  - type BuiltinCommandResult                                                 │
│                                                                              │
│  agent.ts implements:                                                        │
│  - builtinRuntime object (injects mom-specific capabilities)                 │
```

## Core Components

### BuiltinCommandRuntime

Interface that defines the capabilities a command handler needs. UI-agnostic by design.

```typescript
interface BuiltinCommandRuntime {
  // Model management
  modelRegistry: ModelRegistry;
  currentModel: Model | undefined;
  setModel(model: Model): Promise<void>;

  // Session management
  newSession(): Promise<boolean>;
  isStreaming: boolean;
  abort(): Promise<void>;

  // User feedback
  showStatus(message: string): void;
  showError(message: string): void;
}
```

### BuiltinCommandResult

Standardized return type for all builtin commands.

```typescript
interface BuiltinCommandResult {
  handled: boolean;    // Was this command recognized?
  success?: boolean;   // Did it succeed?
  message?: string;    // User-visible feedback
  error?: string;      // Error message (if any)
}
```

### tryBuiltinCommand

Main entry point for command dispatch.

```typescript
async function tryBuiltinCommand(
  name: string,                    // Command name without "/" prefix
  args: string,                    // Raw arguments string
  runtime: BuiltinCommandRuntime   // Injected capabilities
): Promise<BuiltinCommandResult>;
```

## Command Flow

### /model Command

```
User: "/model zai/glm-5"
          │
          ▼
┌─────────────────────────────┐
│ parseSlashCommand()         │
│ → { name: "model",          │
│     args: "zai/glm-5" }     │
└─────────────────────────────┘
          │
          ▼
┌─────────────────────────────┐
│ isBuiltinCommand("model")   │
│ → true                      │
└─────────────────────────────┘
          │
          ▼
┌─────────────────────────────┐
│ tryBuiltinCommand()         │
│ → handleModelCommand()      │
└─────────────────────────────┘
          │
          ▼
┌─────────────────────────────┐
│ findExactModelMatch()       │
│ Searches:                    │
│   - provider/modelId match   │
│   - modelId only match       │
│ Only in getAvailable() list  │
└─────────────────────────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
┌────────┐  ┌─────────────────┐
│ Found  │  │ Not Found       │
│        │  │                 │
│ Switch │  │ findModel       │
│ Model  │  │ Candidates()    │
│        │  │ → Show matches  │
└────────┘  └─────────────────┘
```

### /new Command

```
User: "/new"
          │
          ▼
┌─────────────────────────────┐
│ parseSlashCommand()         │
│ → { name: "new", args: "" } │
└─────────────────────────────┘
          │
          ▼
┌─────────────────────────────┐
│ tryBuiltinCommand()         │
│ → handleNewCommand()        │
└─────────────────────────────┘
          │
          ▼
┌─────────────────────────────┐
│ If streaming: abort()       │
└─────────────────────────────┘
          │
          ▼
┌─────────────────────────────┐
│ newSession()                │
│ → Archive current session   │
│ → Clear context             │
│ → Reset state               │
└─────────────────────────────┘
```

## Model Matching Logic

### findExactModelMatch

Attempts exact match on model ID with optional provider filter.

```typescript
function findExactModelMatch(
  searchTerm: string,      // "glm-5" or "zai/glm-5"
  modelRegistry: ModelRegistry
): Model | undefined {
  // 1. Parse "provider/modelId" format
  // 2. Get available models (hasAuth filter applied!)
  // 3. Match: modelId exact + provider optional
  // 4. Return only if single match
}
```

**Important**: Only searches `modelRegistry.getAvailable()`, which filters models that have valid authentication configured.

### findModelCandidates

Fuzzy search for error suggestions.

```typescript
function findModelCandidates(
  searchTerm: string,
  modelRegistry: ModelRegistry,
  limit: number = 5
): Model[] {
  // Filter: modelId.contains(term) OR provider.contains(term)
  // Case-insensitive
}
```

## Implementation in mom

mom implements its own `BuiltinCommandRuntime` in `agent.ts`:

```typescript
const builtinRuntime: BuiltinCommandRuntime = {
  get modelRegistry() {
    return modelRegistry;
  },
  get currentModel() {
    return agent.state.model;
  },
  async setModel(model) {
    const apiKey = await modelRegistry.getApiKey(model);
    if (!apiKey) {
      throw new Error(`No API key for ${model.provider}/${model.id}`);
    }
    agent.setModel(model);
    sessionManager.appendModelChange(model.provider, model.id);
    settingsManager.setDefaultModelAndProvider(model.provider, model.id);
  },
  async newSession() {
    await resetSession();
    return true;
  },
  get isStreaming() {
    return agent.state.isStreaming;
  },
  async abort() {
    agent.abort();
    await agent.waitForIdle();
  },
  showStatus(message) {
    agentLog.info(`[${channelId}] Status: ${message}`);
  },
  showError(message) {
    agentLog.warning(`[${channelId}] Error: ${message}`);
  },
};
```

