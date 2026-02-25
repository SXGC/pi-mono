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

The builtin command system is organized into three layers within `coding-agent`:

1. **Command Definition** (`slash-commands.ts`) — Defines the list of builtin commands including `model`, `new`, `settings`, and others
2. **Command Parsing** (`command-parser.ts`) — Provides `parseSlashCommand` to extract command name and arguments, plus `isBuiltinCommand` to check if a name matches a builtin
3. **Command Dispatch** (`command-dispatcher.ts`) — Implements `tryBuiltinCommand` which routes to specific handlers, and defines the runtime/result interfaces

The model-matcher module is an internal implementation detail used by command handlers, not part of the public API.

## Public API

The following are exported from `@mariozechner/pi-coding-agent` for consumers:

- `BuiltinCommandRuntime` (interface) — Capabilities a command handler needs
- `BuiltinCommandResult` (interface) — Standardized return type for commands
- `tryBuiltinCommand` (function) — Main entry point for command dispatch
- `parseSlashCommand` (function) — Parse slash command text into name and args
- `isBuiltinCommand` (function) — Check if a command name is builtin

## Core Components

### BuiltinCommandRuntime

Interface that defines the capabilities a command handler needs. UI-agnostic by design.

**Model Management:**
- `modelRegistry` — Access to available models and authentication
- `currentModel` — The currently active model
- `setModel(model)` — Switch to a new model

**Session Management:**
- `newSession()` — Create a fresh session
- `isStreaming` — Whether output is currently streaming
- `abort()` — Cancel current operation

**User Feedback:**
- `showStatus(message)` — Display status information
- `showError(message)` — Display error information

### BuiltinCommandResult

Standardized return type for all builtin commands:

- `handled` — Whether this command was recognized
- `success` — Whether execution succeeded (optional)
- `message` — User-visible feedback text (optional)
- `error` — Error message if something went wrong (optional)

### tryBuiltinCommand

Main entry point for command dispatch. Takes the command name (without slash prefix), raw arguments string, and the runtime capability injection. Returns a `BuiltinCommandResult`.

## Command Flow

### /model Command

1. User types `/model zai/glm-5`
2. `parseSlashCommand` extracts name "model" and args "zai/glm-5"
3. `isBuiltinCommand("model")` confirms it is a builtin
4. `tryBuiltinCommand` routes to `handleModelCommand`
5. If no args provided, returns current model status
6. If args provided, attempts exact match on model ID (with optional provider prefix)
7. On match found, calls `runtime.setModel()` to switch
8. On no match, searches for similar models and shows suggestions

**Model Matching:** Only searches models returned by `modelRegistry.getAvailable()`, which filters to models with valid authentication configured.

### /new Command

1. User types `/new`
2. `parseSlashCommand` extracts name "new" and empty args
3. `tryBuiltinCommand` routes to `handleNewCommand`
4. If any arguments provided, returns usage error
5. If currently streaming, calls `runtime.abort()` first
6. Calls `runtime.newSession()` to archive current session and start fresh

## Implementation in mom

mom imports the command system from `@mariozechner/pi-coding-agent`:

**In `agent.ts`:**
- Imports `tryBuiltinCommand`, `BuiltinCommandRuntime`, and `BuiltinCommandResult` types
- Implements a `builtinRuntime` object that provides mom-specific capabilities:
  - `modelRegistry` — Returns the shared ModelRegistry instance
  - `currentModel` — Returns the agent's current model state
  - `setModel` — Validates API key, updates agent, logs change, persists to settings
  - `newSession` — Archives current session files and resets agent state
  - `isStreaming` — Returns agent streaming state
  - `abort` — Aborts agent and waits for idle
  - `showStatus` / `showError` — Logs to agent logger

**In `slack.ts`:**
- Imports `parseSlashCommand` and `isBuiltinCommand`
- Uses these to detect and route builtin commands before normal message processing
