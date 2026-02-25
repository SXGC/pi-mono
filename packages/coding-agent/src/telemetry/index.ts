/**
 * Telemetry module for coding-agent.
 *
 * Provides OpenTelemetry tracing for agent lifecycle events:
 * - Sessions
 * - Turns (user-assistant exchanges)
 * - Tool executions
 *
 * Shares the OpenTelemetry SDK with @mariozechner/pi-ai.
 *
 * @example
 * ```typescript
 * import { initCodingAgentTelemetry, startSessionSpan, startTurnSpan } from "./telemetry";
 *
 * const shutdown = initCodingAgentTelemetry({
 *   enabled: true,
 *   secretKey: "sk-lf-...",
 *   publicKey: "pk-lf-...",
 * });
 *
 * const sessionSpan = startSessionSpan("session-123");
 * const turnSpan = startTurnSpan("session-123", 0, sessionSpan);
 *
 * // ... agent work ...
 *
 * turnSpan?.end();
 * sessionSpan?.end();
 * await shutdown();
 * ```
 */

export {
	getTracer,
	initCodingAgentTelemetry,
	isTelemetryEnabled,
	shutdownCodingAgentTelemetry,
	startSessionSpan,
	startToolSpan,
	startTurnSpan,
} from "./tracer.js";

export type { TelemetryConfig } from "./types.js";
