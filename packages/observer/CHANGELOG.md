# @mariozechner/pi-observer

## [Unreleased]

### Added
- New package for unified structured logging (Pino) and LLM tracing (OpenTelemetry)
- Logger module with `createLogger()`, `getLogger()` supporting JSON/pretty mode switching
- Tracing module with `initTracing()`, `shutdownTracing()`, `getTracer()`, `isTelemetryEnabled()`
- Langfuse exporter (migrated from @mariozechner/pi-ai/telemetry)
- OTLP exporter for Jaeger and generic OTLP collectors
- Span helper functions: `startSessionSpan()`, `startTurnSpan()`, `startToolSpan()`, `startLLMCallSpan()`
- Support for multiple exporters in parallel
