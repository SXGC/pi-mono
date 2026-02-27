/**
 * Tracing types.
 */

// Re-export shared types
export type { ExporterConfig, LangfuseExporterConfig, OTLPExporterConfig, TracingConfig } from "../types.js";

/**
 * Langfuse-specific configuration (for backward compatibility).
 */
export type LangfuseConfig = {
	/** Whether telemetry is enabled */
	enabled: boolean;
} & Omit<import("../types.js").LangfuseExporterConfig, "type">;
/**
 * TelemetryConfig is an alias for LangfuseConfig (backward compatibility).
 * @deprecated Use LangfuseConfig instead
 */
export type TelemetryConfig = LangfuseConfig;

/**
 * Convert LangfuseConfig to TracingConfig for backward compatibility.
 */
export function langfuseConfigToTracingConfig(config: LangfuseConfig): import("../types.js").TracingConfig {
	return {
		enabled: config.enabled,
		exporters: [
			{
				type: "langfuse",
				secretKey: config.secretKey,
				publicKey: config.publicKey,
				baseUrl: config.baseUrl,
			},
		],
	};
}
