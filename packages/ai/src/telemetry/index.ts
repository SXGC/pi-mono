/**
 * Langfuse OpenTelemetry tracing module.
 *
 * This module re-exports tracing functionality from @mariozechner/pi-observer
 * for backward compatibility.
 *
 * @example
 * ```typescript
 * import { initTelemetry } from "@mariozechner/pi-ai/telemetry";
 *
 * const shutdown = initTelemetry({
 *   enabled: true,
 *   secretKey: "sk-lf-...",
 *   publicKey: "pk-lf-...",
 * });
 *
 * // ... use LLM APIs ...
 *
 * await shutdown();
 * ```
 */

// Re-export types for backward compatibility
export type { TelemetryConfig as LangfuseConfig } from "@mariozechner/pi-observer/tracing";
// Re-export tracing functions from observer (backward compatible API)
// Re-export the langfuseConfigToTracingConfig helper for backward compatibility
export {
	getTracer,
	initTracing as initTelemetry,
	isTelemetryEnabled,
	langfuseConfigToTracingConfig as langfuseConfigToTelemetryConfig,
	safeSpanOperation,
	shutdownTelemetry,
} from "@mariozechner/pi-observer/tracing";
