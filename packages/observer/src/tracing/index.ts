// Re-export Span type for consumers
export type { Span } from "@opentelemetry/api";
export { startLLMCallSpan, startSessionSpan, startToolSpan, startTurnSpan } from "./spans.js";
export {
	getTracer,
	initTracing,
	isTelemetryDebugEnabled,
	isTelemetryEnabled,
	logTelemetryDebug,
	safeSpanOperation,
	shutdownTracing,
	shutdownTracing as shutdownTelemetry,
} from "./tracer.js";
export type {
	ExporterConfig,
	LangfuseConfig,
	LangfuseExporterConfig,
	OTLPExporterConfig,
	TelemetryConfig,
	TracingConfig,
} from "./types.js";
// Re-export langfuseConfigToTracingConfig as a value (it's a function)
export { langfuseConfigToTracingConfig } from "./types.js";
