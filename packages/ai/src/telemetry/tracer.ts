import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { TelemetryConfig } from "./types.js";

let sdk: NodeSDK | undefined;

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
	// Silently return if disabled
	if (!config.enabled) {
		return async () => {};
	}

	// Get credentials from config or environment variables
	const secretKey = config.secretKey ?? process.env.LANGFUSE_SECRET_KEY;
	const publicKey = config.publicKey ?? process.env.LANGFUSE_PUBLIC_KEY;
	const baseUrl = config.baseUrl ?? process.env.LANGFUSE_BASE_URL;

	// Silently return if missing required credentials
	if (!secretKey || !publicKey) {
		return async () => {};
	}

	try {
		const spanProcessor = new LangfuseSpanProcessor({
			secretKey,
			publicKey,
			baseUrl,
		});

		sdk = new NodeSDK({
			spanProcessors: [spanProcessor],
		});

		sdk.start();

		return async () => {
			if (sdk) {
				await sdk.shutdown();
				sdk = undefined;
			}
		};
	} catch (error) {
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
	try {
		await sdk.shutdown();
	} catch (error) {
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
