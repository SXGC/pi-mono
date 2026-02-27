/**
 * OpenTelemetry tracer initialization and management.
 *
 * Supports multiple exporters (Langfuse, OTLP) running in parallel.
 */

import { type Tracer, trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { ExporterConfig, TracingConfig } from "../types.js";
import { createLangfuseSpanProcessor, logTelemetryDebug } from "./exporters/langfuse.js";
import { createOTLPSpanProcessor } from "./exporters/otlp.js";

/**
 * Default service name.
 */
const DEFAULT_SERVICE_NAME = "pi";

/**
 * Global SDK instance.
 */
let sdk: NodeSDK | undefined;

/**
 * Global tracer instance.
 */
let tracer: Tracer | undefined;

/**
 * Whether telemetry is enabled.
 */
let telemetryEnabled = false;

/**
 * Create a span processor for an exporter configuration.
 */
function createSpanProcessor(config: ExporterConfig) {
	switch (config.type) {
		case "langfuse":
			return createLangfuseSpanProcessor(config);
		case "otlp":
			return createOTLPSpanProcessor(config);
		default:
			throw new Error(`Unknown exporter type: ${(config as { type: string }).type}`);
	}
}

/**
 * Initialize OpenTelemetry tracing with pluggable exporters.
 *
 * If disabled or missing credentials, returns a no-op shutdown function.
 * Initialization failures are silently degraded with a console warning.
 *
 * @param config - Tracing configuration
 * @returns Shutdown function to cleanly stop the SDK
 *
 * @example
 * ```typescript
 * import { initTracing } from "@mariozechner/pi-observer";
 *
 * const shutdown = initTracing({
 *   enabled: true,
 *   exporters: [
 *     { type: "langfuse", secretKey: "sk-lf-...", publicKey: "pk-lf-..." },
 *     { type: "otlp", endpoint: "http://localhost:4318/v1/traces" }
 *   ]
 * });
 *
 * // ... use LLM APIs ...
 *
 * await shutdown();
 * ```
 */
export function initTracing(config: TracingConfig): () => Promise<void> {
	logTelemetryDebug("init requested", {
		enabled: config.enabled,
		exporterCount: config.exporters?.length ?? 0,
		serviceName: config.serviceName ?? DEFAULT_SERVICE_NAME,
	});

	// Silently return if disabled
	if (!config.enabled) {
		logTelemetryDebug("init skipped: telemetry disabled");
		return async () => {};
	}

	// If no exporters specified, default to Langfuse for backward compatibility
	const exporters = config.exporters ?? [{ type: "langfuse" as const }];

	// Build span processors
	const spanProcessors = [];
	const errors: string[] = [];

	for (const exporterConfig of exporters) {
		try {
			const processor = createSpanProcessor(exporterConfig);
			spanProcessors.push(processor);
			logTelemetryDebug(`created span processor for ${exporterConfig.type}`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			errors.push(`${exporterConfig.type}: ${errorMessage}`);
			logTelemetryDebug(`failed to create span processor for ${exporterConfig.type}`, {
				error: errorMessage,
			});
		}
	}

	// If no processors were created, return no-op
	if (spanProcessors.length === 0) {
		logTelemetryDebug("init skipped: no valid exporters", { errors });
		if (errors.length > 0) {
			console.warn("Failed to initialize any telemetry exporters:", errors.join("; "));
		}
		return async () => {};
	}

	try {
		const serviceName = config.serviceName ?? DEFAULT_SERVICE_NAME;

		sdk = new NodeSDK({
			serviceName,
			spanProcessors,
		});

		sdk.start();
		tracer = trace.getTracer(serviceName);
		telemetryEnabled = true;

		logTelemetryDebug("OpenTelemetry SDK started", {
			serviceName,
			processorCount: spanProcessors.length,
		});

		return async () => {
			if (sdk) {
				logTelemetryDebug("shutdown via init return started");
				await sdk.shutdown();
				logTelemetryDebug("shutdown via init return completed");
				sdk = undefined;
				tracer = undefined;
				telemetryEnabled = false;
			}
		};
	} catch (error) {
		logTelemetryDebug("init failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		// Silently degrade on initialization failure
		console.warn("Failed to initialize telemetry:", error);
		return async () => {};
	}
}

/**
 * Shutdown the telemetry SDK if it was initialized.
 * Errors are caught and logged, never thrown.
 */
export async function shutdownTracing(): Promise<void> {
	if (!sdk) return;
	logTelemetryDebug("shutdownTracing started");
	try {
		await sdk.shutdown();
		logTelemetryDebug("shutdownTracing completed");
	} catch (error) {
		logTelemetryDebug("shutdownTracing failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		console.warn("Failed to shutdown telemetry:", error);
	} finally {
		sdk = undefined;
		tracer = undefined;
		telemetryEnabled = false;
	}
}

/**
 * Check if telemetry is currently enabled (SDK initialized).
 */
export function isTelemetryEnabled(): boolean {
	return telemetryEnabled;
}

/**
 * Get the OpenTelemetry tracer if telemetry is enabled.
 * Returns undefined if telemetry is not initialized.
 */
export function getTracer(name?: string): Tracer | undefined {
	if (!telemetryEnabled) return undefined;
	return name ? trace.getTracer(name) : tracer;
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

// Re-export debug utilities
export { isTelemetryDebugEnabled, logTelemetryDebug } from "./exporters/langfuse.js";
