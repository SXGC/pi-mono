# Settings Configuration

Mom's behavior can be customized via `settings.json` in the workspace root directory.

## Location

```
./data/
  └── settings.json    # Global settings
```

## Configuration Reference

### Response Settings

Control which message types trigger mom to respond.

```json
{
  "response": {
    "mention": true,
    "dm": true,
    "channel": false
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mention` | boolean | `true` | Respond to @mentions in channels |
| `dm` | boolean | `true` | Respond to direct messages |
| `channel` | boolean | `false` | Respond to regular channel messages (not @mentions) |

### Model Settings

Set the default model and provider.

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium"
}
```

| Option | Type | Description |
|--------|------|-------------|
| `defaultProvider` | string | Default LLM provider (e.g., `anthropic`, `openai`) |
| `defaultModel` | string | Default model ID |
| `defaultThinkingLevel` | string | Thinking level: `off`, `minimal`, `low`, `medium`, `high` |

### Compaction Settings

Control how mom compacts context when it exceeds the model's context window.

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable automatic compaction |
| `reserveTokens` | number | `16384` | Tokens to reserve for response |
| `keepRecentTokens` | number | `20000` | Recent tokens to keep in full |

### Retry Settings

Configure retry behavior when LLM requests fail.

```json
{
  "retry": {
    "enabled": true,
    "maxRetries": 3,
    "baseDelayMs": 2000
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable automatic retry |
| `maxRetries` | number | `3` | Maximum retry attempts |
| `baseDelayMs` | number | `2000` | Base delay in milliseconds (exponential backoff) |

### Image Settings

Control image handling behavior.

```json
{
  "images": {
    "autoResize": true
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoResize` | boolean | `true` | Automatically resize large images |

### Fallback Settings

Configure fallback models when the primary model fails or rate limits.

```json
{
  "fallback": {
    "enabled": true,
    "models": [
      { "provider": "anthropic", "modelId": "claude-sonnet-4-20250514" },
      { "provider": "openai", "modelId": "gpt-4o" }
    ],
    "onFallbackExhausted": "error"
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable fallback behavior |
| `models` | array | - | Ordered list of fallback models |
| `onFallbackExhausted` | string | `error` | Action when all fallbacks fail: `error` or `ask` |

### Langfuse Settings

Configure Langfuse telemetry for observability.

```json
{
  "langfuse": {
    "enabled": true,
    "secretKey": "sk-lf-...",
    "publicKey": "pk-lf-...",
    "baseUrl": "https://cloud.langfuse.com"
  }
}
```

| Option | Type | Description |
|--------|------|-------------|
| `enabled` | boolean | Enable Langfuse telemetry |
| `secretKey` | string | Langfuse secret key (can also use `LANGFUSE_SECRET_KEY` env var) |
| `publicKey` | string | Langfuse public key (can also use `LANGFUSE_PUBLIC_KEY` env var) |
| `baseUrl` | string | Custom Langfuse instance URL (optional) |

### Other Settings

```json
{
  "shellCommandPrefix": "/bin/bash",
  "theme": "dark",
  "obsidianPath": "/path/to/obsidian/vault"
}
```

| Option | Type | Description |
|--------|------|-------------|
| `shellCommandPrefix` | string | Shell prefix for bash commands |
| `theme` | string | UI theme preference |
| `obsidianPath` | string | Path to Obsidian vault for note integration |

## Full Example

```json
{
  "response": {
    "mention": true,
    "dm": true,
    "channel": false
  },
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  },
  "retry": {
    "enabled": true,
    "maxRetries": 3,
    "baseDelayMs": 2000
  },
  "images": {
    "autoResize": true
  },
  "fallback": {
    "enabled": true,
    "models": [
      { "provider": "anthropic", "modelId": "claude-sonnet-4-20250514" }
    ],
    "onFallbackExhausted": "error"
  },
  "langfuse": {
    "enabled": false
  }
}
```

## Changing Settings at Runtime

Use the `/model` command to switch models at runtime:

```
@mom /model anthropic/claude-sonnet-4-20250514
```

This updates `defaultProvider` and `defaultModel` in `settings.json`.
