import "./providers/register-builtins.js";
import { getTracer, isTelemetryEnabled, logTelemetryDebug, type Span } from "@mariozechner/pi-observer/tracing";
import "./utils/http-proxy.js";

import { getApiProvider } from "./api-registry.js";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Message,
	Model,
	ProviderStreamOptions,
	SimpleStreamOptions,
	StreamOptions,
} from "./types.js";
import { AssistantMessageEventStream as EventStream } from "./utils/event-stream.js";
import { log } from "./utils/logger.js";

export { getEnvApiKey } from "./env-api-keys.js";

const MAX_SERIALIZED_ATTRIBUTE_LENGTH = 120_000;
const DEFAULT_TELEMETRY_USER_ID = "pi";

function truncateText(text: string, maxLength = 8_000): string {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength)}...[truncated ${text.length - maxLength} chars]`;
}

function serializeForAttribute(value: unknown): string | undefined {
	try {
		const serialized = typeof value === "string" ? value : JSON.stringify(value);
		if (serialized.length <= MAX_SERIALIZED_ATTRIBUTE_LENGTH) {
			return serialized;
		}
		return `${serialized.slice(0, MAX_SERIALIZED_ATTRIBUTE_LENGTH)}...[truncated ${serialized.length - MAX_SERIALIZED_ATTRIBUTE_LENGTH} chars]`;
	} catch (error) {
		logTelemetryDebug("failed to serialize telemetry attribute", {
			error: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}

function sanitizeMessagesForTelemetry(messages: Message[]): Array<Record<string, unknown>> {
	return messages.map((message) => {
		if (message.role === "user") {
			const content =
				typeof message.content === "string"
					? truncateText(message.content)
					: message.content.map((part) =>
							part.type === "text"
								? { type: "text", text: truncateText(part.text) }
								: {
										type: "image",
										mimeType: part.mimeType,
										data: `[base64:${part.data.length} chars]`,
									},
						);

			return {
				role: "user",
				timestamp: message.timestamp,
				content,
			};
		}

		if (message.role === "assistant") {
			return {
				role: "assistant",
				timestamp: message.timestamp,
				content: message.content.map((part) => {
					if (part.type === "text") {
						return { type: "text", text: truncateText(part.text) };
					}
					if (part.type === "thinking") {
						return { type: "thinking", thinking: truncateText(part.thinking) };
					}
					return {
						type: "toolCall",
						id: part.id,
						name: part.name,
						arguments: part.arguments,
					};
				}),
			};
		}

		return {
			role: "toolResult",
			timestamp: message.timestamp,
			toolCallId: message.toolCallId,
			toolName: message.toolName,
			isError: message.isError,
			content: message.content.map((part) =>
				part.type === "text"
					? { type: "text", text: truncateText(part.text) }
					: {
							type: "image",
							mimeType: part.mimeType,
							data: `[base64:${part.data.length} chars]`,
						},
			),
		};
	});
}

function sanitizeAssistantMessageForTelemetry(message: AssistantMessage): Record<string, unknown> {
	return {
		role: message.role,
		provider: message.provider,
		model: message.model,
		stopReason: message.stopReason,
		errorMessage: message.errorMessage,
		timestamp: message.timestamp,
		content: message.content.map((part) => {
			if (part.type === "text") {
				return { type: "text", text: truncateText(part.text) };
			}
			if (part.type === "thinking") {
				return { type: "thinking", thinking: truncateText(part.thinking) };
			}
			return {
				type: "toolCall",
				id: part.id,
				name: part.name,
				arguments: part.arguments,
			};
		}),
	};
}

function resolveTelemetryUserId(options?: StreamOptions): string {
	const metadata = options?.metadata;
	if (!metadata) {
		return DEFAULT_TELEMETRY_USER_ID;
	}

	const fromUserId = metadata.userId;
	if (typeof fromUserId === "string" && fromUserId.trim().length > 0) {
		return fromUserId;
	}

	const fromUserIdSnakeCase = metadata.user_id;
	if (typeof fromUserIdSnakeCase === "string" && fromUserIdSnakeCase.trim().length > 0) {
		return fromUserIdSnakeCase;
	}

	return DEFAULT_TELEMETRY_USER_ID;
}

function createLlmCallSpan<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: StreamOptions,
): Span | undefined {
	if (!isTelemetryEnabled()) {
		logTelemetryDebug("skip span creation: telemetry disabled in stream module", {
			model: model.id,
			provider: model.provider,
			sessionId: options?.sessionId,
		});
		return undefined;
	}

	const tracer = getTracer();
	if (!tracer) {
		logTelemetryDebug("skip span creation: tracer unavailable", {
			model: model.id,
			provider: model.provider,
			sessionId: options?.sessionId,
		});
		return undefined;
	}

	const userId = resolveTelemetryUserId(options);
	const serializedInput = serializeForAttribute({
		systemPrompt: context.systemPrompt,
		messages: sanitizeMessagesForTelemetry(context.messages),
		tools: context.tools?.map((tool) => ({
			name: tool.name,
			description: tool.description,
		})),
	});

	const attributes: Record<string, string | number | boolean> = {
		"gen_ai.request.model": model.id,
		"gen_ai.request.provider": model.provider,
		"user.id": userId,
		"langfuse.user.id": userId,
	};

	if (options?.sessionId) {
		attributes["session.id"] = options.sessionId;
		attributes["langfuse.session.id"] = options.sessionId;
	}

	if (serializedInput) {
		attributes["langfuse.observation.input"] = serializedInput;
		attributes["input.value"] = serializedInput;
		attributes["langfuse.trace.input"] = serializedInput;
	}

	const span = tracer.startSpan("llm-call", {
		attributes,
	});

	logTelemetryDebug("llm-call span started", {
		model: model.id,
		provider: model.provider,
		sessionId: options?.sessionId,
		userId,
	});

	return span;
}

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
	const span = createLlmCallSpan(model, context, options as StreamOptions);
	if (!span) {
		return eventStream;
	}

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
	const eventStream = provider.streamSimple(model, context, options);
	const span = createLlmCallSpan(model, context, options);
	if (!span) {
		return eventStream;
	}

	return wrapStreamWithSpan(eventStream, span);
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
 * Records usage and errors when the stream completes.
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
						const serializedOutput = serializeForAttribute(sanitizeAssistantMessageForTelemetry(msg));
						const serializedUsageDetails = serializeForAttribute({
							inputTokens: msg.usage.input,
							outputTokens: msg.usage.output,
							totalTokens: msg.usage.totalTokens,
							reasoningTokens: 0,
							cachedInputTokens: msg.usage.cacheRead,
						});

						const doneAttributes: Record<string, string | number | boolean> = {
							"gen_ai.usage.input_tokens": msg.usage.input,
							"gen_ai.usage.output_tokens": msg.usage.output,
							"gen_ai.usage.total_tokens": msg.usage.totalTokens,
							"gen_ai.usage.cached_input_tokens": msg.usage.cacheRead,
							"gen_ai.usage.reasoning_tokens": 0,
						};

						if (serializedUsageDetails) {
							doneAttributes["langfuse.observation.usage_details"] = serializedUsageDetails;
						}
						if (serializedOutput) {
							doneAttributes["langfuse.observation.output"] = serializedOutput;
							doneAttributes["output.value"] = serializedOutput;
							doneAttributes["langfuse.trace.output"] = serializedOutput;
						}

						span.setAttributes(doneAttributes);
					} catch (spanError) {
						log.warn(
							{ error: spanError instanceof Error ? spanError.message : String(spanError) },
							"Failed to set span attributes",
						);
					}
					try {
						span.end();
					} catch (spanError) {
						log.warn(
							{ error: spanError instanceof Error ? spanError.message : String(spanError) },
							"Failed to end span",
						);
					}
				}
				// Record error on error event
				else if (event.type === "error") {
					try {
						const serializedErrorOutput = serializeForAttribute({
							role: "assistant",
							stopReason: "error",
							errorMessage: event.error.errorMessage,
							timestamp: event.error.timestamp,
						});
						if (serializedErrorOutput) {
							span.setAttributes({
								"langfuse.observation.output": serializedErrorOutput,
								"output.value": serializedErrorOutput,
								"langfuse.trace.output": serializedErrorOutput,
							});
						}
						if (event.error.errorMessage) {
							span.recordException(new Error(event.error.errorMessage));
						}
					} catch (spanError) {
						log.warn(
							{ error: spanError instanceof Error ? spanError.message : String(spanError) },
							"Failed to record exception",
						);
					}
					try {
						span.end();
					} catch (spanError) {
						log.warn(
							{ error: spanError instanceof Error ? spanError.message : String(spanError) },
							"Failed to end span",
						);
					}
				}
			}
		} catch (error) {
			// Record unexpected errors
			try {
				span.recordException(error instanceof Error ? error : new Error(String(error)));
			} catch (spanError) {
				log.warn(
					{ error: spanError instanceof Error ? spanError.message : String(spanError) },
					"Failed to record exception",
				);
			}
			try {
				span.end();
			} catch (spanError) {
				log.warn(
					{ error: spanError instanceof Error ? spanError.message : String(spanError) },
					"Failed to end span",
				);
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
