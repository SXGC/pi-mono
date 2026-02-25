import "./providers/register-builtins.js";
import type { Span } from "@opentelemetry/api";
import { getTracer, isTelemetryEnabled } from "./telemetry/tracer.js";
import "./utils/http-proxy.js";

import { getApiProvider } from "./api-registry.js";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	ProviderStreamOptions,
	SimpleStreamOptions,
	StreamOptions,
} from "./types.js";
import { AssistantMessageEventStream as EventStream } from "./utils/event-stream.js";

export { getEnvApiKey } from "./env-api-keys.js";

function resolveApiProvider(api: Api) {
	const provider = getApiProvider(api);
	if (!provider) {
		throw new Error(`No API provider registered for api: ${api}`);
	}
	return provider;
}

export function stream<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: ProviderStreamOptions,
): AssistantMessageEventStream {
	const provider = resolveApiProvider(model.api);
	const eventStream = provider.stream(model, context, options as StreamOptions);

	// Return unmodified stream if telemetry is not enabled
	if (!isTelemetryEnabled()) {
		return eventStream;
	}

	const tracer = getTracer();
	if (!tracer) {
		return eventStream;
	}

	// Create span for LLM call tracking
	const span = tracer.startSpan("llm-call", {
		attributes: {
			"gen_ai.request.model": model.id,
			"gen_ai.request.provider": model.provider,
			...(options?.sessionId && { "session.id": options.sessionId }),
		},
	});

	// Wrap the event stream to track completion and errors
	return wrapStreamWithSpan(eventStream, span);
}

export async function complete<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: ProviderStreamOptions,
): Promise<AssistantMessage> {
	const s = stream(model, context, options);
	return s.result();
}

export function streamSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const provider = resolveApiProvider(model.api);
	return provider.streamSimple(model, context, options);
}

export async function completeSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
	const s = streamSimple(model, context, options);
	return s.result();
}

/**
 * Wraps an event stream with OpenTelemetry span tracking.
 * Records usage, cost, and errors when the stream completes.
 * All span operations are wrapped in try-catch to prevent telemetry failures from disrupting the stream.
 */
function wrapStreamWithSpan(eventStream: AssistantMessageEventStream, span: Span): AssistantMessageEventStream {
	const wrappedStream = new EventStream();

	// Forward events asynchronously and track completion
	(async () => {
		try {
			for await (const event of eventStream) {
				wrappedStream.push(event);

				// Record metrics on done event
				if (event.type === "done") {
					const msg = event.message;
					try {
						span.setAttributes({
							"gen_ai.usage.input_tokens": msg.usage.input,
							"gen_ai.usage.output_tokens": msg.usage.output,
							"gen_ai.cost.total": msg.usage.cost.total,
						});
					} catch (spanError) {
						console.warn("Failed to set span attributes:", spanError);
					}
					try {
						span.end();
					} catch (spanError) {
						console.warn("Failed to end span:", spanError);
					}
				}
				// Record error on error event
				else if (event.type === "error") {
					try {
						if (event.error.errorMessage) {
							span.recordException(new Error(event.error.errorMessage));
						}
					} catch (spanError) {
						console.warn("Failed to record exception:", spanError);
					}
					try {
						span.end();
					} catch (spanError) {
						console.warn("Failed to end span:", spanError);
					}
				}
			}
		} catch (error) {
			// Record unexpected errors
			try {
				span.recordException(error instanceof Error ? error : new Error(String(error)));
			} catch (spanError) {
				console.warn("Failed to record exception:", spanError);
			}
			try {
				span.end();
			} catch (spanError) {
				console.warn("Failed to end span:", spanError);
			}
			// Propagate error to wrapped stream
			wrappedStream.push({
				type: "error",
				reason: "error",
				error: {
					role: "assistant",
					content: [],
					api: "openai-completions" as const,
					provider: "unknown",
					model: "unknown",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "error",
					errorMessage: error instanceof Error ? error.message : String(error),
					timestamp: Date.now(),
				},
			});
		}
	})();

	return wrappedStream;
}
