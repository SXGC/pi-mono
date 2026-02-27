/**
 * Tracing types.
 */

// Re-export shared types
export type { ExporterConfig, LangfuseExporterConfig, OTLPExporterConfig, TracingConfig } from "../types.js";

/**
 * Langfuse-specific configuration (for backward compatibility).
 */
export interface LangfuseConfig {
	/** Whether telemetry is enabled */
	enabled: boolean;
	/** Langfuse secret key (falls back to LANGFUSE_SECRET_KEY env var) */
	secretKey?: string;
	/** Langfuse public key (falls back to LANGFUSE_PUBLIC_KEY env var) */
	publicKey?: string;
	/** Langfuse base URL (falls back to LANGFUSE_BASE_URL env var) */
	baseUrl?: string;
}
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
