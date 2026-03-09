import type { TracingConfig } from "./types.js";

// Re-export Span type for consumers
export type { Span } from "@opentelemetry/api";
export { logTelemetryDebug } from "./debug.js";
export { startLLMCallSpan, startSessionSpan, startToolSpan, startTurnSpan } from "./spans.js";
export { getTracer, isTelemetryEnabled } from "./state.js";
export type {
	ExporterConfig,
	LangfuseConfig,
	LangfuseExporterConfig,
	OTLPExporterConfig,
	TelemetryConfig,
	TracingConfig,
} from "./types.js";
// Re-export langfuseConfigToTracingConfig as a value (it's a function)
export { langfuseConfigToTracingConfig } from "./types.js";

interface TracingRuntimeModule {
	initTracing: (config: TracingConfig) => () => Promise<void>;
	shutdownTracing: () => Promise<void>;
}

type DynamicImport = (specifier: string) => Promise<unknown>;

const dynamicImport: DynamicImport = (specifier) => import(specifier);
const TRACER_RUNTIME_SPECIFIER = "./" + "tracer.js";

async function loadTracingRuntime(): Promise<TracingRuntimeModule> {
	const module = await dynamicImport(TRACER_RUNTIME_SPECIFIER);
	return module as TracingRuntimeModule;
}

export function initTracing(config: TracingConfig): () => Promise<void> {
	const shutdownPromise = loadTracingRuntime().then((runtime) => runtime.initTracing(config));
	return async () => {
		const shutdown = await shutdownPromise;
		await shutdown();
	};
}

export async function shutdownTracing(): Promise<void> {
	const runtime = await loadTracingRuntime();
	await runtime.shutdownTracing();
}

export { shutdownTracing as shutdownTelemetry };

export function safeSpanOperation<T>(operation: () => T, fallback: T): T {
	try {
		return operation();
	} catch (error) {
		console.error("Telemetry operation failed:", error);
		return fallback;
	}
}
