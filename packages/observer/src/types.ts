/**
 * Shared types for the observer package.
 */

/**
 * Log levels supported by the logger.
 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Exporter type for tracing.
 */
export type ExporterType = "langfuse" | "otlp";

/**
 * Langfuse exporter configuration.
 */
export interface LangfuseExporterConfig {
	type: "langfuse";
	/** Langfuse secret key (falls back to LANGFUSE_SECRET_KEY env var) */
	secretKey?: string;
	/** Langfuse public key (falls back to LANGFUSE_PUBLIC_KEY env var) */
	publicKey?: string;
	/** Langfuse base URL (falls back to LANGFUSE_BASE_URL env var) */
	baseUrl?: string;
}

/**
 * OTLP exporter configuration for Jaeger or generic OTLP collectors.
 */
export interface OTLPExporterConfig {
	type: "otlp";
	/** OTLP endpoint URL (defaults to http://localhost:4318/v1/traces) */
	endpoint?: string;
	/** Optional headers for authentication */
	headers?: Record<string, string>;
}

/**
 * Union type for all exporter configurations.
 */
export type ExporterConfig = LangfuseExporterConfig | OTLPExporterConfig;

/**
 * Tracing configuration.
 */
export interface TracingConfig {
	/** Whether tracing is enabled */
	enabled: boolean;
	/** List of exporters to use (supports multiple exporters in parallel) */
	exporters?: ExporterConfig[];
	/** Service name for OpenTelemetry (default: "pi") */
	serviceName?: string;
}

/**
 * Logger configuration.
 */
export interface LoggerConfig {
	/** Log level (default: "info") */
	level?: LogLevel;
	/** Use pino-pretty for formatted output (default: true in development) */
	pretty?: boolean;
	/** Logger instance name for identification */
	name?: string;
	/** Custom output stream (default: stdout) */
	destination?: NodeJS.WritableStream;
}
