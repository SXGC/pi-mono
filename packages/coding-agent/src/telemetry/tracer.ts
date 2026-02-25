import {
	initTelemetry as initAiTelemetry,
	shutdownTelemetry as shutdownAiTelemetry,
} from "@mariozechner/pi-ai/telemetry";
import { type Span, type Tracer, trace } from "@opentelemetry/api";
import type { TelemetryConfig } from "./types.js";

let tracer: Tracer | undefined;
let telemetryEnabled = false;

/**
 * Initialize telemetry (delegates to @mariozechner/pi-ai).
 * Coding-agent shares the OpenTelemetry SDK with the ai package.
 *
 * @param config - Telemetry configuration
 * @returns Shutdown function to cleanly stop the SDK
 */
export function initCodingAgentTelemetry(config: TelemetryConfig): () => Promise<void> {
	const shutdown = initAiTelemetry(config);

	if (config.enabled) {
		tracer = trace.getTracer("@mariozechner/pi-coding-agent");
		telemetryEnabled = true;
	}

	return async () => {
		await shutdown();
		tracer = undefined;
		telemetryEnabled = false;
	};
}

/**
 * Shutdown telemetry (delegates to @mariozechner/pi-ai).
 */
export async function shutdownCodingAgentTelemetry(): Promise<void> {
	await shutdownAiTelemetry();
	tracer = undefined;
	telemetryEnabled = false;
}

/**
 * Get the OpenTelemetry tracer for coding-agent.
 * Returns undefined if telemetry is not initialized.
 */
export function getTracer(): Tracer | undefined {
	return tracer;
}

/**
 * Check if telemetry is enabled.
 */
export function isTelemetryEnabled(): boolean {
	return telemetryEnabled;
}

/**
 * Start a session span.
 * Returns undefined if telemetry is disabled or on error.
 *
 * @param sessionId - The session ID
 * @returns The span, or undefined if telemetry is disabled
 */
export function startSessionSpan(sessionId: string): Span | undefined {
	if (!tracer) return undefined;
	try {
		return tracer.startSpan(`session:${sessionId}`, {
			attributes: {
				"session.id": sessionId,
			},
		});
	} catch (error) {
		console.warn("Failed to start session span:", error);
		return undefined;
	}
}

/**
 * Start a turn span within a session.
 * Returns undefined if telemetry is disabled or on error.
 *
 * @param sessionId - The session ID
 * @param turnIndex - The turn index (0-based)
 * @param parentSpan - Optional parent span to link to
 * @returns The span, or undefined if telemetry is disabled
 */
export function startTurnSpan(sessionId: string, turnIndex: number, parentSpan?: Span): Span | undefined {
	if (!tracer) return undefined;
	try {
		return tracer.startSpan(`turn:${turnIndex}`, {
			attributes: {
				"session.id": sessionId,
				"turn.index": turnIndex,
			},
			...(parentSpan && { parent: parentSpan }),
		});
	} catch (error) {
		console.warn("Failed to start turn span:", error);
		return undefined;
	}
}

/**
 * Start a tool span.
 * Returns undefined if telemetry is disabled or on error.
 *
 * @param toolName - The name of the tool being executed
 * @param parentSpan - Optional parent span to link to
 * @returns The span, or undefined if telemetry is disabled
 */
export function startToolSpan(toolName: string, parentSpan?: Span): Span | undefined {
	if (!tracer) return undefined;
	try {
		return tracer.startSpan(`tool:${toolName}`, {
			attributes: {
				"tool.name": toolName,
			},
			...(parentSpan && { parent: parentSpan }),
		});
	} catch (error) {
		console.warn("Failed to start tool span:", error);
		return undefined;
	}
}
