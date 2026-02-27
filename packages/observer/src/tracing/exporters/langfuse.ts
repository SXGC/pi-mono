/**
 * Langfuse OpenTelemetry exporter.
 *
 * Provides a SpanProcessor that exports traces to Langfuse.
 */

import { LangfuseSpanProcessor } from "@langfuse/otel";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { getLogger } from "../../logger/index.js";
import type { LangfuseExporterConfig } from "../types.js";

const log = getLogger({ name: "pi-observer" });

/**
 * Log telemetry debug message using observer logger.
 */
export function logTelemetryDebug(message: string, details?: Record<string, unknown>): void {
	if (details) {
		log.debug(details, message);
		return;
	}
	log.debug(message);
}
/**
 * Attach debug hooks to a span processor.
 */
function attachSpanProcessorDebugHooks(spanProcessor: LangfuseSpanProcessor): LangfuseSpanProcessor {
	type ProcessorOnStartSpan = Parameters<LangfuseSpanProcessor["onStart"]>[0];
	type ProcessorOnStartContext = Parameters<LangfuseSpanProcessor["onStart"]>[1];
	type ProcessorOnEndSpan = Parameters<LangfuseSpanProcessor["onEnd"]>[0];

	const originalOnStart = spanProcessor.onStart.bind(spanProcessor);
	spanProcessor.onStart = (span: ProcessorOnStartSpan, parentContext: ProcessorOnStartContext) => {
		const spanContext = span.spanContext();
		logTelemetryDebug("span started", {
			traceId: spanContext.traceId,
			spanId: spanContext.spanId,
		});
		originalOnStart(span, parentContext);
	};

	const originalOnEnd = spanProcessor.onEnd.bind(spanProcessor);
	spanProcessor.onEnd = (span: ProcessorOnEndSpan) => {
		const spanContext = span.spanContext();
		logTelemetryDebug("span queued for export", {
			name: span.name,
			traceId: spanContext.traceId,
			spanId: spanContext.spanId,
		});
		originalOnEnd(span);
	};

	const originalForceFlush = spanProcessor.forceFlush.bind(spanProcessor);
	spanProcessor.forceFlush = async () => {
		const startedAt = Date.now();
		logTelemetryDebug("forceFlush started");
		try {
			await originalForceFlush();
			logTelemetryDebug("forceFlush completed", {
				durationMs: Date.now() - startedAt,
			});
		} catch (error) {
			logTelemetryDebug("forceFlush failed", {
				durationMs: Date.now() - startedAt,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	};

	const originalShutdown = spanProcessor.shutdown.bind(spanProcessor);
	spanProcessor.shutdown = async () => {
		const startedAt = Date.now();
		logTelemetryDebug("span processor shutdown started");
		try {
			await originalShutdown();
			logTelemetryDebug("span processor shutdown completed", {
				durationMs: Date.now() - startedAt,
			});
		} catch (error) {
			logTelemetryDebug("span processor shutdown failed", {
				durationMs: Date.now() - startedAt,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	};

	return spanProcessor;
}

/**
 * Create a Langfuse span processor.
 *
 * @param config - Langfuse exporter configuration
 * @returns Langfuse span processor
 */
export function createLangfuseSpanProcessor(config: LangfuseExporterConfig): SpanProcessor {
	const secretKey = config.secretKey;
	const publicKey = config.publicKey;
	const baseUrl = config.baseUrl;

	logTelemetryDebug("creating Langfuse span processor", {
		hasSecretKey: Boolean(secretKey),
		hasPublicKey: Boolean(publicKey),
		baseUrl: baseUrl ?? "https://cloud.langfuse.com",
	});

	if (!secretKey || !publicKey) {
		throw new Error(
			"Langfuse credentials not configured in settings file. Set langfuse.secretKey and langfuse.publicKey.",
		);
	}

	const spanProcessor = new LangfuseSpanProcessor({
		secretKey,
		publicKey,
		baseUrl,
	});

	return attachSpanProcessorDebugHooks(spanProcessor);
}
