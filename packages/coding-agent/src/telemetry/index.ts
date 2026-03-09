/**
 * Telemetry module for coding-agent.
 *
 * Provides OpenTelemetry tracing for agent lifecycle events:
 * - Sessions
 * - Turns (user-assistant exchanges)
 * - Tool executions
 *
 * Re-exports tracing functionality from @mariozechner/pi-observer.
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

import {
	type ExporterConfig,
	getTracer,
	initTracing,
	isTelemetryEnabled,
	type LangfuseConfig,
	langfuseConfigToTracingConfig,
	shutdownTelemetry,
	startSessionSpan,
	startToolSpan,
	startTurnSpan,
	type TracingConfig,
} from "@mariozechner/pi-observer";

// Re-export types for backward compatibility
export type { LangfuseConfig as TelemetryConfig } from "@mariozechner/pi-observer";

// Re-export tracing functions from observer
export { getTracer, isTelemetryEnabled, startSessionSpan, startToolSpan, startTurnSpan };

/**
 * Tracing settings from settings.json (subset of TracingConfig).
 * This matches the TracingSettings interface from settings-manager.
 */
export interface CodingAgentTracingSettings {
	enabled: boolean;
	langfuse?: {
		secretKey?: string;
		publicKey?: string;
		baseUrl?: string;
	};
	otlp?: {
		endpoint?: string;
		headers?: Record<string, string>;
	};
}

/**
 * Convert CodingAgentTracingSettings to TracingConfig for observer.
 */
export function tracingSettingsToConfig(settings: CodingAgentTracingSettings): TracingConfig {
	if (!settings.enabled) {
		return { enabled: false };
	}

	const exporters: ExporterConfig[] = [];

	if (settings.langfuse) {
		exporters.push({
			type: "langfuse",
			secretKey: settings.langfuse.secretKey,
			publicKey: settings.langfuse.publicKey,
			baseUrl: settings.langfuse.baseUrl,
		});
	}

	if (settings.otlp) {
		exporters.push({
			type: "otlp",
			endpoint: settings.otlp.endpoint,
			headers: settings.otlp.headers,
		});
	}

	// Default to langfuse if no exporters specified but enabled
	if (exporters.length === 0) {
		exporters.push({ type: "langfuse" });
	}

	return {
		enabled: true,
		exporters,
	};
}

/**
 * Initialize coding-agent telemetry with Langfuse configuration.
 * This is a backward-compatible wrapper that converts LangfuseConfig to TracingConfig.
 */
export function initCodingAgentTelemetry(config: LangfuseConfig): () => Promise<void> {
	return initTracing(langfuseConfigToTracingConfig(config));
}

/**
 * Initialize coding-agent telemetry with TracingSettings.
 * Use this for new code that supports multiple exporters.
 */
export function initCodingAgentTracing(settings: CodingAgentTracingSettings): () => Promise<void> {
	return initTracing(tracingSettingsToConfig(settings));
}

/**
 * Shutdown coding-agent telemetry.
 */
export async function shutdownCodingAgentTelemetry(): Promise<void> {
	await shutdownTelemetry();
}
