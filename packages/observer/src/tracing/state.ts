import { type Tracer, trace } from "@opentelemetry/api";

let tracer: Tracer | undefined;
let telemetryEnabled = false;

export function setTracingState(nextTracer: Tracer | undefined, enabled: boolean): void {
	tracer = nextTracer;
	telemetryEnabled = enabled;
}

export function resetTracingState(): void {
	tracer = undefined;
	telemetryEnabled = false;
}

export function isTelemetryEnabled(): boolean {
	return telemetryEnabled;
}

export function getTracer(name?: string): Tracer | undefined {
	if (!telemetryEnabled) {
		return undefined;
	}

	return name ? trace.getTracer(name) : tracer;
}
