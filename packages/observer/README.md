# @mariozechner/pi-observer

Unified structured logging (Pino) and LLM tracing (OpenTelemetry) for pi packages.

## Installation

```bash
npm install @mariozechner/pi-observer
```

## Logger (Pino)

### Quick Start

```typescript
import { createLogger, getLogger } from "@mariozechner/pi-observer";

// Create a named logger
const log = createLogger({ name: "coding-agent", level: "debug" });
log.info({ sessionId: "abc", model: "claude-4" }, "session started");
log.warn({ tokenCount: 190000, limit: 200000 }, "approaching context limit");

// Or use the global default logger
const defaultLog = getLogger();
defaultLog.info("Application started");
```

### Logger Configuration

```typescript
interface LoggerConfig {
  level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal"; // default: "info"
  pretty?: boolean;         // default: true (use pino-pretty), false for JSON output
  name?: string;            // logger instance name
  destination?: NodeJS.WritableStream; // custom output stream, default: stdout
}
```

## Tracing (OpenTelemetry)

### Quick Start

```typescript
import { initTracing, shutdownTracing, startSessionSpan, startTurnSpan, startToolSpan } from "@mariozechner/pi-observer";

// Initialize with multiple exporters
const shutdown = initTracing({
  enabled: true,
  exporters: [
    { type: "langfuse", secretKey: "sk-lf-...", publicKey: "pk-lf-..." },
    { type: "otlp", endpoint: "http://localhost:4318/v1/traces" }
  ]
});

// Create spans for agent lifecycle
const sessionSpan = startSessionSpan("session-123");
const turnSpan = startTurnSpan("session-123", 0, sessionSpan);
const toolSpan = startToolSpan("read", turnSpan);

// ... agent work ...

toolSpan?.end();
turnSpan?.end();
sessionSpan?.end();

// Shutdown when done
await shutdown();
```

### Tracing Configuration

```typescript
interface TracingConfig {
  enabled: boolean;
  exporters?: ExporterConfig[];  // supports multiple exporters in parallel
  serviceName?: string;          // default: "pi"
}

type ExporterConfig =
  | { type: "langfuse"; secretKey?: string; publicKey?: string; baseUrl?: string }
  | { type: "otlp"; endpoint?: string; headers?: Record<string, string> };
```

### Span Helpers

| Function | Description |
|----------|-------------|
| `startSessionSpan(sessionId)` | Start a session span |
| `startTurnSpan(sessionId, turnIndex, parent?)` | Start a turn span within a session |
| `startToolSpan(toolName, parent?)` | Start a tool execution span |
| `startLLMCallSpan(modelId, provider, sessionId?, userId?)` | Start an LLM call span |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | OTLP endpoint (default: `http://localhost:4318/v1/traces`) |

## License

MIT
