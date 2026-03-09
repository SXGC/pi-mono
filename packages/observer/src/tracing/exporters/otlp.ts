/**
 * OTLP (OpenTelemetry Protocol) exporter.
 *
 * Supports Jaeger and generic OTLP collectors.
 */

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { logTelemetryDebug } from "../debug.js";
import type { OTLPExporterConfig } from "../types.js";

/**
 * Default OTLP endpoint.
 */
const DEFAULT_OTLP_ENDPOINT = "http://localhost:4318/v1/traces";

/**
 * Create an OTLP span processor.
 *
 * @param config - OTLP exporter configuration
 * @returns OTLP span processor
 */
export function createOTLPSpanProcessor(config: OTLPExporterConfig): SpanProcessor {
	const endpoint = config.endpoint ?? process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? DEFAULT_OTLP_ENDPOINT;

	logTelemetryDebug("creating OTLP span processor", {
		endpoint,
		hasHeaders: Boolean(config.headers),
	});

	const exporter = new OTLPTraceExporter({
		url: endpoint,
		headers: config.headers,
	});

	return new BatchSpanProcessor(exporter);
}
