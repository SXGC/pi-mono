/**
 * Langfuse OpenTelemetry exporter.
 *
 * Provides a SpanProcessor that exports traces to Langfuse.
 */

import { LangfuseSpanProcessor } from "@langfuse/otel";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { LangfuseExporterConfig } from "../types.js";

/**
 * Debug environment variable names.
 */
const TELEMETRY_DEBUG_ENV = ["LANGFUSE_DEBUG", "PI_TELEMETRY_DEBUG"] as const;

/**
 * Check if a value is truthy.
 */
function isTruthyEnv(value: string | undefined): boolean {
	if (!value) return false;
	return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

/**
 * Check if telemetry debug mode is enabled.
 */
export function isTelemetryDebugEnabled(): boolean {
	return TELEMETRY_DEBUG_ENV.some((name) => isTruthyEnv(process.env[name]));
}

/**
 * Log telemetry debug message.
 */
export function logTelemetryDebug(message: string, details?: Record<string, unknown>): void {
	if (!isTelemetryDebugEnabled()) return;
	if (details) {
		console.info(`[pi-observer] ${message}`, details);
		return;
	}
	console.info(`[pi-observer] ${message}`);
}

/**
 * Attach debug hooks to a span processor.
 */
function attachSpanProcessorDebugHooks(spanProcessor: LangfuseSpanProcessor): LangfuseSpanProcessor {
	if (!isTelemetryDebugEnabled()) {
		return spanProcessor;
	}

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
	const secretKey = config.secretKey ?? process.env.LANGFUSE_SECRET_KEY;
	const publicKey = config.publicKey ?? process.env.LANGFUSE_PUBLIC_KEY;
	const baseUrl = config.baseUrl ?? process.env.LANGFUSE_BASE_URL;

	logTelemetryDebug("creating Langfuse span processor", {
		hasSecretKey: Boolean(secretKey),
		hasPublicKey: Boolean(publicKey),
		baseUrl: baseUrl ?? "https://cloud.langfuse.com",
	});

	if (!secretKey || !publicKey) {
		throw new Error(
			"Langfuse credentials not configured. Set LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY environment variables.",
		);
	}

	const spanProcessor = new LangfuseSpanProcessor({
		secretKey,
		publicKey,
		baseUrl,
	});

	return attachSpanProcessorDebugHooks(spanProcessor);
}
