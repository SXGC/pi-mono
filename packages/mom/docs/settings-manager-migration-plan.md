# Mom SettingsManager Migration Plan

## Goal

Align `packages/mom` with the `main` branch direction for agent/session settings by using the real `SettingsManager` from `packages/coding-agent`, while keeping mom-specific runtime settings in `packages/mom`.

This plan avoids the current split where:

- `agent.ts` wants a real `SettingsManager`
- `main.ts`, `slack.ts`, and some tests still depend on mom-specific settings helpers
- both sides may write the same `settings.json` with different semantics

## Decision Summary

Use a **split-responsibility model**:

1. **Shared agent settings** are owned by `packages/coding-agent`'s `SettingsManager`
2. **Mom-only runtime settings** stay in `packages/mom`
3. Both read and write the same workspace `settings.json`
4. Mom-only writes must use the same locked read-modify-write pattern as `SettingsManager`

## What Moves to `packages/coding-agent`

These settings already exist in `packages/coding-agent/src/core/settings-manager.ts`, or are close enough that mom should stop re-implementing them:

- `defaultProvider`
- `defaultModel`
- `defaultThinkingLevel`
- `compaction`
- `retry`
- `fallback`
- `branchSummary`
- `images.autoResize`
- `shellCommandPrefix`
- `theme`
- `langfuse`

These are part of the shared agent/session contract and are already consumed by `AgentSession`.

## What Stays in `packages/mom`

These settings are mom runtime concerns and should not be promoted into the generic coding-agent settings API:

- `response`
  - `mention`
  - `dm`
  - `channel`
- `env`
- `applyEnvToProcessEnv()`
- `getLogLevel()` / `env.MOM_LOG_LEVEL`
- `obsidianPath`

These are only used by mom startup, Slack integration, or mom-specific prompt/runtime behavior.

## Why Not Move Everything

Moving all mom-specific fields into `packages/coding-agent` would make the shared settings model aware of Slack and mom-specific runtime semantics.

That would:

- weaken package boundaries
- expand documentation and testing burden in coding-agent
- make the generic settings API harder to reason about
- introduce fields that are not used by core agent flows

## Target Architecture

### 1. `WorkspaceSettingsStorage`

Keep `WorkspaceSettingsStorage` in `packages/mom/src/context.ts` as a storage adapter for the workspace root `settings.json`.

It should only implement the storage contract needed by `SettingsManager.fromStorage(...)`:

- `withLock(scope, fn)`

It should **not** contain manager-style getters/setters.

### 2. `createMomSettingsManager(workspaceDir)`

Keep or restore:

```ts
export function createMomSettingsManager(workspaceDir: string): SettingsManager
```

It should return:

```ts
SettingsManager.fromStorage(new WorkspaceSettingsStorage(workspaceDir))
```

This is the object passed into `AgentSession`.

### 3. `MomRuntimeSettings`

Introduce a mom-local helper in `packages/mom/src/context.ts` or a nearby file, for example:

```ts
export class MomRuntimeSettings
```

This helper is responsible only for mom-only settings:

- `getResponseSettings()`
- `setResponseSettings()`
- `getEnv()`
- `applyEnvToProcessEnv()`
- `getLogLevel()`
- `setLogLevel()`
- `getObsidianPath()`
- `setObsidianPath()`

It should not duplicate shared agent settings logic.

## Write Model

### How `SettingsManager` Writes Today

`packages/coding-agent/src/core/settings-manager.ts` writes in four stages:

1. setter updates in-memory state
2. modified fields are tracked
3. write is queued through `enqueueWrite(...)`
4. `storage.withLock(scope, fn)` performs locked read-modify-write persistence

Important behavior:

- writes are queued, not immediately flushed to disk
- only modified fields are merged back into the file
- `flush()` is required when tests or follow-up readers need durable persistence

### How Mom-Only Settings Must Write

Mom-only settings must **not** keep a long-lived full-file cache and then overwrite `settings.json`.

That would race with `SettingsManager` and risk losing unrelated fields.

Instead, mom-only writes must also use locked read-modify-write against the current file contents.

Recommended pattern:

```ts
storage.withLock("global", (current) => {
  const settings = current ? JSON.parse(current) : {};
  settings.response = {
    ...(typeof settings.response === "object" && settings.response ? settings.response : {}),
    mention: true,
  };
  return JSON.stringify(settings, null, 2);
});
```

Rules:

- always read the latest file inside the lock
- only update mom-owned fields
- never overwrite the entire settings object from a stale in-memory snapshot

## Scope Semantics

`SettingsManager` supports `global` and `project` scopes.

Mom currently uses a single workspace-level `settings.json`, which behaves closer to a custom global store.

### Current Risk

The current `WorkspaceSettingsStorage.withLock()` implementation treats `project` as an effective no-op. That is dangerous because future shared code may attempt project-scope writes and silently lose data.

### Plan

- mom should only rely on `global` scope in this migration
- `WorkspaceSettingsStorage` should not silently swallow project writes
- if project scope is unsupported, fail explicitly or document/test the current behavior clearly

## Caller Split

### `packages/mom/src/agent.ts`

Use two collaborators:

- `agentSettings: SettingsManager`
- `momSettings: MomRuntimeSettings`

Responsibilities:

- `agentSettings` for AgentSession construction and shared settings
- `momSettings` for `obsidianPath` and other mom-only reads

### `packages/mom/src/main.ts`

Use `MomRuntimeSettings` for:

- `applyEnvToProcessEnv()`
- `getLogLevel()`
- startup telemetry-related reads if still mom-owned

Use `SettingsManager` only if startup also needs shared settings behavior.

### `packages/mom/src/slack.ts`

Depend only on the narrow mom-only API it needs:

- `getResponseSettings()`

Avoid requiring the full `MomSettingsManager` shape.

## Test Migration

### Move to `packages/coding-agent`

Shared settings behavior tests should live with `SettingsManager`:

- fallback persistence behavior
- retry persistence behavior
- compaction persistence behavior
- shared settings merge semantics

### Keep in `packages/mom`

Mom tests should focus on mom-specific integration:

- workspace single-file storage wiring
- `response` settings behavior
- env injection behavior
- `MOM_LOG_LEVEL` handling
- `obsidianPath` access

### Async Persistence Requirement

Any test that writes shared settings via `SettingsManager` and then expects disk persistence must call:

```ts
await settingsManager.flush()
```

This is required because `SettingsManager` writes through an async queue.

## Implementation Plan

### Phase 1: Stabilize the split

- Resolve `packages/mom/src/context.ts` conflict by keeping:
  - `syncLogToSessionManager()`
  - `WorkspaceSettingsStorage`
  - `createMomSettingsManager()`
- Remove shared-setting getters/setters from the storage adapter
- Introduce or restore a separate mom-only runtime settings helper

### Phase 2: Update callers

- Update `packages/mom/src/agent.ts` to use:
  - real `SettingsManager` for `AgentSession`
  - mom-only helper for `obsidianPath`
- Update `packages/mom/src/main.ts` to use mom-only helper for env/log settings
- Update `packages/mom/src/slack.ts` to depend on the narrow response-settings API

### Phase 3: Fix write semantics

- Ensure mom-only setters use locked read-modify-write
- Ensure no code path writes stale whole-file snapshots
- Decide and document the behavior for unsupported `project` scope

### Phase 4: Test cleanup

- Move duplicated shared-settings tests out of mom where appropriate
- Add or update mom integration tests for runtime-only fields
- Add `flush()` where tests depend on persisted shared settings writes

## Risks

### 1. Lost updates

If mom-only code writes `settings.json` from a stale cached object, it can overwrite unrelated fields written by `SettingsManager`.

### 2. Silent project-scope data loss

If `WorkspaceSettingsStorage` continues swallowing project writes, future shared features may appear to work but fail to persist.

### 3. Test breakage from async writes

Old mom tests assume synchronous writes. After migration, persistence-sensitive tests must wait on `flush()`.

### 4. API drift

If `slack.ts` and `main.ts` keep depending on a large catch-all manager, mom will drift back toward a duplicated settings layer.

## Verification Checklist

- `AgentSession` receives a real `SettingsManager`
- mom startup still applies env and log level correctly
- Slack response gating still honors `response.mention`, `response.dm`, and `response.channel`
- `obsidianPath` remains readable in mom flows
- shared settings persist correctly through `SettingsManager`
- mom-only settings persist correctly through locked partial updates
- no unsupported project-scope write is silently lost

## Recommended Final State

The final design should look like this:

- `packages/coding-agent`
  - owns shared agent settings model and persistence behavior
- `packages/mom`
  - owns workspace storage adaptation
  - owns mom runtime-only settings
  - does not re-implement shared agent settings logic

This preserves the main-branch architectural direction without forcing Slack- or mom-specific semantics into the shared coding-agent core.
