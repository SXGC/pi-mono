import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { TelemetryConfig } from "./types.js";

let sdk: NodeSDK | undefined;

const TELEMETRY_DEBUG_ENV = ["LANGFUSE_DEBUG", "PI_TELEMETRY_DEBUG"] as const;

function isTruthyEnv(value: string | undefined): boolean {
	if (!value) return false;
	return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function isTelemetryDebugEnabled(): boolean {
	return TELEMETRY_DEBUG_ENV.some((name) => isTruthyEnv(process.env[name]));
}

function logTelemetryDebug(message: string, details?: Record<string, unknown>): void {
	if (!isTelemetryDebugEnabled()) return;
	if (details) {
		console.info(`[langfuse-telemetry] ${message}`, details);
		return;
	}
	console.info(`[langfuse-telemetry] ${message}`);
}

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
 * Initialize OpenTelemetry with Langfuse span processor.
 *
 * If disabled or missing credentials, this function returns a no-op shutdown function.
 * Initialization failures are silently degraded with a console warning.
 *
 * @param config - Telemetry configuration
 * @returns Shutdown function to cleanly stop the SDK
 */
export function initTelemetry(config: TelemetryConfig): () => Promise<void> {
	logTelemetryDebug("init requested", {
		enabled: config.enabled,
		hasConfigSecretKey: Boolean(config.secretKey),
		hasConfigPublicKey: Boolean(config.publicKey),
		hasConfigBaseUrl: Boolean(config.baseUrl),
	});

	// Silently return if disabled
	if (!config.enabled) {
		logTelemetryDebug("init skipped: telemetry disabled");
		return async () => {};
	}

	// Get credentials from config or environment variables
	const secretKey = config.secretKey ?? process.env.LANGFUSE_SECRET_KEY;
	const publicKey = config.publicKey ?? process.env.LANGFUSE_PUBLIC_KEY;
	const baseUrl = config.baseUrl ?? process.env.LANGFUSE_BASE_URL;

	logTelemetryDebug("resolved credentials", {
		hasSecretKey: Boolean(secretKey),
		hasPublicKey: Boolean(publicKey),
		baseUrl: baseUrl ?? "https://cloud.langfuse.com",
	});

	// Silently return if missing required credentials
	if (!secretKey || !publicKey) {
		logTelemetryDebug("init skipped: missing credentials", {
			hasSecretKey: Boolean(secretKey),
			hasPublicKey: Boolean(publicKey),
		});
		return async () => {};
	}

	try {
		const spanProcessor = attachSpanProcessorDebugHooks(
			new LangfuseSpanProcessor({
				secretKey,
				publicKey,
				baseUrl,
			}),
		);

		logTelemetryDebug("span processor created");

		sdk = new NodeSDK({
			spanProcessors: [spanProcessor],
		});

		sdk.start();
		logTelemetryDebug("OpenTelemetry SDK started");

		return async () => {
			if (sdk) {
				logTelemetryDebug("shutdown via init return started");
				await sdk.shutdown();
				logTelemetryDebug("shutdown via init return completed");
				sdk = undefined;
			}
		};
	} catch (error) {
		logTelemetryDebug("init failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		// Silently degrade on initialization failure
		console.warn("Failed to initialize Langfuse telemetry:", error);
		return async () => {};
	}
}

/**
 * Shutdown the telemetry SDK if it was initialized.
 * Errors are caught and logged, never thrown.
 */
export async function shutdownTelemetry(): Promise<void> {
	if (!sdk) return;
	logTelemetryDebug("shutdownTelemetry started");
	try {
		await sdk.shutdown();
		logTelemetryDebug("shutdownTelemetry completed");
	} catch (error) {
		logTelemetryDebug("shutdownTelemetry failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		console.warn("Failed to shutdown telemetry:", error);
	} finally {
		sdk = undefined;
	}
}

import { trace } from "@opentelemetry/api";

const TRACER_NAME = "pi-ai";

/**
 * Check if telemetry is currently enabled (SDK initialized).
 */
export function isTelemetryEnabled(): boolean {
	return sdk !== undefined;
}

/**
 * Get the OpenTelemetry tracer if telemetry is enabled.
 * Returns undefined if telemetry is not initialized.
 */
export function getTracer() {
	if (!sdk) {
		return undefined;
	}
	return trace.getTracer(TRACER_NAME);
}

/**
 * Safely execute a telemetry operation, returning a fallback value on failure.
 * Errors are logged as warnings and do not throw.
 *
 * @param operation - The operation to execute
 * @param fallback - The fallback value to return on error
 * @returns The operation result or fallback value
 */
export function safeSpanOperation<T>(operation: () => T, fallback: T): T {
	try {
		return operation();
	} catch (error) {
		console.warn("Telemetry operation failed:", error);
		return fallback;
	}
}
