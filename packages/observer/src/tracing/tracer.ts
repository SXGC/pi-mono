/**
 * OpenTelemetry tracer initialization and management.
 *
 * Supports multiple exporters (Langfuse, OTLP) running in parallel.
 */

import { type Tracer, trace } from "@opentelemetry/api";
import type { NodeSDK } from "@opentelemetry/sdk-node";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { ExporterConfig, TracingConfig } from "../types.js";
import { logTelemetryDebug } from "./debug.js";
import {
	getTracer as getSharedTracer,
	isTelemetryEnabled as isSharedTelemetryEnabled,
	resetTracingState,
	setTracingState,
} from "./state.js";

interface LangfuseExporterModule {
	createLangfuseSpanProcessor: (config: Extract<ExporterConfig, { type: "langfuse" }>) => SpanProcessor;
}

interface OtlpExporterModule {
	createOTLPSpanProcessor: (config: Extract<ExporterConfig, { type: "otlp" }>) => SpanProcessor;
}

interface NodeSdkModule {
	NodeSDK: new (config: { serviceName: string; spanProcessors: SpanProcessor[] }) => NodeSDK;
}

type DynamicImport = (specifier: string) => Promise<unknown>;

const dynamicImport: DynamicImport = (specifier) => import(specifier);
const SDK_NODE_SPECIFIER = "@opentelemetry/" + "sdk-node";
const LANGFUSE_EXPORTER_SPECIFIER = "./exporters/" + "langfuse.js";
const OTLP_EXPORTER_SPECIFIER = "./exporters/" + "otlp.js";

/**
 * Default service name.
 */
const DEFAULT_SERVICE_NAME = "pi";

/**
 * Global SDK instance.
 */
let sdk: NodeSDK | undefined;
let initializationPromise: Promise<void> | undefined;

/**
 * Create a span processor for an exporter configuration.
 */
async function createSpanProcessor(config: ExporterConfig): Promise<SpanProcessor> {
	switch (config.type) {
		case "langfuse": {
			const module = (await dynamicImport(LANGFUSE_EXPORTER_SPECIFIER)) as LangfuseExporterModule;
			return module.createLangfuseSpanProcessor(config);
		}
		case "otlp": {
			const module = (await dynamicImport(OTLP_EXPORTER_SPECIFIER)) as OtlpExporterModule;
			return module.createOTLPSpanProcessor(config);
		}
		default:
			throw new Error(`Unknown exporter type: ${(config as { type: string }).type}`);
	}
}

async function initializeTracing(config: TracingConfig): Promise<void> {
	// If no exporters specified, default to Langfuse for backward compatibility
	const exporters = config.exporters ?? [{ type: "langfuse" as const }];

	// Build span processors
	const spanProcessors: SpanProcessor[] = [];
	const errors: string[] = [];

	for (const exporterConfig of exporters) {
		try {
			const processor = await createSpanProcessor(exporterConfig);
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
			console.error("Failed to initialize any telemetry exporters:", errors.join("; "));
		}
		resetTracingState();
		return;
	}

	const serviceName = config.serviceName ?? DEFAULT_SERVICE_NAME;
	const module = (await dynamicImport(SDK_NODE_SPECIFIER)) as NodeSdkModule;

	sdk = new module.NodeSDK({
		serviceName,
		spanProcessors,
	});

	sdk.start();
	setTracingState(trace.getTracer(serviceName), true);

	logTelemetryDebug("OpenTelemetry SDK started", {
		serviceName,
		processorCount: spanProcessors.length,
	});
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
		resetTracingState();
		initializationPromise = undefined;
		return async () => {};
	}

	initializationPromise = initializeTracing(config).catch((error) => {
		logTelemetryDebug("init failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		resetTracingState();
		sdk = undefined;
		console.error("Failed to initialize telemetry:", error);
	});

	return async () => {
		if (initializationPromise) {
			await initializationPromise;
		}
		if (sdk) {
			logTelemetryDebug("shutdown via init return started");
			await sdk.shutdown();
			logTelemetryDebug("shutdown via init return completed");
			sdk = undefined;
			resetTracingState();
		}
	};
}

/**
 * Shutdown the telemetry SDK if it was initialized.
 * Errors are caught and logged, never thrown.
 */
export async function shutdownTracing(): Promise<void> {
	if (initializationPromise) {
		await initializationPromise;
	}
	if (!sdk) return;
	logTelemetryDebug("shutdownTracing started");
	try {
		await sdk.shutdown();
		logTelemetryDebug("shutdownTracing completed");
	} catch (error) {
		logTelemetryDebug("shutdownTracing failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		console.error("Failed to shutdown telemetry:", error);
	} finally {
		sdk = undefined;
		initializationPromise = undefined;
		resetTracingState();
	}
}

/**
 * Check if telemetry is currently enabled (SDK initialized).
 */
export function isTelemetryEnabled(): boolean {
	return isSharedTelemetryEnabled();
}

/**
 * Get the OpenTelemetry tracer if telemetry is enabled.
 * Returns undefined if telemetry is not initialized.
 */
export function getTracer(name?: string): Tracer | undefined {
	return getSharedTracer(name);
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
		console.error("Telemetry operation failed:", error);
		return fallback;
	}
}

// Re-export debug utilities
export { logTelemetryDebug } from "./debug.js";
