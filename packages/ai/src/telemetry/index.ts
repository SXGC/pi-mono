/**
 * Langfuse OpenTelemetry tracing module.
 *
 * Provides initialization and configuration for tracing LLM calls
 * via OpenTelemetry with Langfuse as the backend.
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

 * await shutdown();
 * ```
 */

export { getTracer, initTelemetry, isTelemetryEnabled, safeSpanOperation, shutdownTelemetry } from "./tracer.js";
export type { TelemetryConfig } from "./types.js";
