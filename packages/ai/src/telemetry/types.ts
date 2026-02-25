/**
 * Configuration for Langfuse OpenTelemetry tracing.
 */
export interface TelemetryConfig {
	/** Whether telemetry is enabled */
	enabled: boolean;
	/** Langfuse secret key (falls back to LANGFUSE_SECRET_KEY env var) */
	secretKey?: string;
	/** Langfuse public key (falls back to LANGFUSE_PUBLIC_KEY env var) */
	publicKey?: string;
	/** Langfuse base URL (falls back to LANGFUSE_BASE_URL env var) */
	baseUrl?: string;
}
