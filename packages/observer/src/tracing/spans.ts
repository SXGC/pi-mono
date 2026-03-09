/**
 * Span helper functions for common telemetry patterns.
 *
 * Provides utilities for creating session, turn, and tool spans.
 */

import type { Span } from "@opentelemetry/api";
import { getTracer } from "./state.js";

/**
 * Start a session span.
 * Returns undefined if telemetry is disabled or on error.
 *
 * @param sessionId - The session ID
 * @param tracerName - Optional tracer name (defaults to global tracer)
 * @returns The span, or undefined if telemetry is disabled
 */
export function startSessionSpan(sessionId: string, tracerName?: string): Span | undefined {
	const tracer = getTracer(tracerName);
	if (!tracer) return undefined;
	try {
		return tracer.startSpan(`session:${sessionId}`, {
			attributes: {
				"session.id": sessionId,
			},
		});
	} catch (error) {
		console.error("Failed to start session span:", error);
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
 * @param tracerName - Optional tracer name (defaults to global tracer)
 * @returns The span, or undefined if telemetry is disabled
 */
export function startTurnSpan(
	sessionId: string,
	turnIndex: number,
	parentSpan?: Span,
	tracerName?: string,
): Span | undefined {
	const tracer = getTracer(tracerName);
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
		console.error("Failed to start turn span:", error);
		return undefined;
	}
}

/**
 * Start a tool span.
 * Returns undefined if telemetry is disabled or on error.
 *
 * @param toolName - The name of the tool being executed
 * @param parentSpan - Optional parent span to link to
 * @param tracerName - Optional tracer name (defaults to global tracer)
 * @returns The span, or undefined if telemetry is disabled
 */
export function startToolSpan(toolName: string, parentSpan?: Span, tracerName?: string): Span | undefined {
	const tracer = getTracer(tracerName);
	if (!tracer) return undefined;
	try {
		return tracer.startSpan(`tool:${toolName}`, {
			attributes: {
				"tool.name": toolName,
			},
			...(parentSpan && { parent: parentSpan }),
		});
	} catch (error) {
		console.error("Failed to start tool span:", error);
		return undefined;
	}
}

/**
 * Start an LLM call span.
 * Returns undefined if telemetry is disabled or on error.
 *
 * @param modelId - The model ID
 * @param provider - The provider name
 * @param sessionId - Optional session ID
 * @param userId - Optional user ID
 * @param tracerName - Optional tracer name (defaults to global tracer)
 * @returns The span, or undefined if telemetry is disabled
 */
export function startLLMCallSpan(
	modelId: string,
	provider: string,
	sessionId?: string,
	userId?: string,
	tracerName?: string,
): Span | undefined {
	const tracer = getTracer(tracerName);
	if (!tracer) return undefined;
	try {
		const attributes: Record<string, string | number | boolean> = {
			"gen_ai.request.model": modelId,
			"gen_ai.request.provider": provider,
		};

		if (userId) {
			attributes["user.id"] = userId;
			attributes["langfuse.user.id"] = userId;
		}

		if (sessionId) {
			attributes["session.id"] = sessionId;
			attributes["langfuse.session.id"] = sessionId;
		}

		return tracer.startSpan("llm-call", { attributes });
	} catch (error) {
		console.error("Failed to start LLM call span:", error);
		return undefined;
	}
}
