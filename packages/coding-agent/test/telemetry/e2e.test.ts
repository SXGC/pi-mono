import { context, type HrTime, trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerApiProvider, unregisterApiProviders } from "../../../ai/src/api-registry.js";
import { stream } from "../../../ai/src/stream.js";
import type { AssistantMessage, Context, Message, Model } from "../../../ai/src/types.js";
import { createAssistantMessageEventStream } from "../../../ai/src/utils/event-stream.js";
import {
	initCodingAgentTelemetry,
	isTelemetryEnabled,
	shutdownCodingAgentTelemetry,
	startSessionSpan,
	startToolSpan,
	startTurnSpan,
} from "../../src/telemetry/index.js";

const telemetryState = vi.hoisted(() => ({
	finishedSpans: [] as unknown[],
}));

vi.mock("@langfuse/otel", () => {
	class MockLangfuseSpanProcessor {
		onStart(): void {}

		onEnd(span: unknown): void {
			telemetryState.finishedSpans.push(span);
		}

		forceFlush(): Promise<void> {
			return Promise.resolve();
		}

		shutdown(): Promise<void> {
			return Promise.resolve();
		}
	}

	return { LangfuseSpanProcessor: MockLangfuseSpanProcessor };
});

vi.mock("@mariozechner/pi-ai", async () => {
	const telemetryModule = await import("../../../ai/src/telemetry/index.js");
	return {
		initTelemetry: telemetryModule.initTelemetry,
		shutdownTelemetry: telemetryModule.shutdownTelemetry,
	};
});

const MOCK_API = "telemetry-e2e-mock" as const;
const MOCK_PROVIDER = "telemetry-e2e" as const;
const PROVIDER_SOURCE_ID = "coding-agent-telemetry-e2e";

type TelemetrySpan = {
	name: string;
	parentSpanContext?: { spanId: string };
	spanContext: () => { spanId: string };
	startTime: HrTime;
	endTime: HrTime;
	ended: boolean;
	attributes: Record<string, unknown>;
	events: Array<{ name: string }>;
};

function toNanos(time: HrTime): bigint {
	return BigInt(time[0]) * 1_000_000_000n + BigInt(time[1]);
}

function findSpan(spans: ReadonlyArray<TelemetrySpan>, name: string): TelemetrySpan {
	const span = spans.find((item) => item.name === name);
	if (!span) {
		throw new Error(`Span not found: ${name}`);
	}
	return span;
}

function messageHasFlag(messages: ReadonlyArray<Message>, flag: string): boolean {
	return messages.some((message) => {
		if (message.role !== "user") return false;
		if (typeof message.content === "string") {
			return message.content.includes(flag);
		}
		return message.content.some((content) => content.type === "text" && content.text.includes(flag));
	});
}

function createMockProvider() {
	return {
		api: MOCK_API,
		stream: (model: Model<typeof MOCK_API>, contextValue: Context) => {
			const eventStream = createAssistantMessageEventStream();

			queueMicrotask(() => {
				const baseMessage = {
					role: "assistant",
					content: [{ type: "text", text: "mock-response" }],
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: {
						input: 17,
						output: 9,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 26,
						cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
					},
					timestamp: Date.now(),
				} satisfies Omit<AssistantMessage, "stopReason">;

				if (messageHasFlag(contextValue.messages, "force-error")) {
					eventStream.push({
						type: "error",
						reason: "error",
						error: {
							...baseMessage,
							stopReason: "error",
							errorMessage: "mock provider failure",
						},
					});
					return;
				}

				eventStream.push({
					type: "done",
					reason: "stop",
					message: {
						...baseMessage,
						stopReason: "stop",
					},
				});
			});

			return eventStream;
		},
		streamSimple: (model: Model<typeof MOCK_API>, contextValue: Context) => {
			return createMockProvider().stream(model, contextValue);
		},
	};
}

describe("Telemetry E2E", () => {
	beforeEach(() => {
		telemetryState.finishedSpans.length = 0;
		registerApiProvider(createMockProvider(), PROVIDER_SOURCE_ID);
	});

	afterEach(async () => {
		unregisterApiProviders(PROVIDER_SOURCE_ID);
		telemetryState.finishedSpans.length = 0;
		await shutdownCodingAgentTelemetry();
	});

	it("should track complete agent session flow", async () => {
		const config = {
			enabled: true,
			secretKey: "test-secret",
			publicKey: "test-public",
			baseUrl: "http://localhost:3000",
		};
		const shutdown = initCodingAgentTelemetry(config);

		const sessionId = "session-e2e-success";
		const turnIndex = 0;
		const model: Model<typeof MOCK_API> = {
			id: "mock-model-v1",
			name: "Mock Model",
			api: MOCK_API,
			provider: MOCK_PROVIDER,
			baseUrl: "http://localhost:3000/mock",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 8000,
			maxTokens: 2000,
		};

		try {
			expect(isTelemetryEnabled()).toBe(true);

			const sessionSpan = startSessionSpan(sessionId);
			expect(sessionSpan).toBeDefined();

			const turnSpan = context.with(trace.setSpan(context.active(), sessionSpan!), () =>
				startTurnSpan(sessionId, turnIndex, sessionSpan),
			);
			expect(turnSpan).toBeDefined();

			const llmEventStream = context.with(trace.setSpan(context.active(), turnSpan!), () =>
				stream(
					model,
					{
						messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
					},
					{ sessionId },
				),
			);

			const llmMessage = await llmEventStream.result();
			expect(llmMessage.stopReason).toBe("stop");

			const toolSpan = context.with(trace.setSpan(context.active(), turnSpan!), () =>
				startToolSpan("mock-tool", turnSpan),
			);
			expect(toolSpan).toBeDefined();
			toolSpan?.setAttributes({
				"tool.call_id": "tool-call-1",
				"tool.is_error": false,
			});
			toolSpan?.end();

			turnSpan?.end();
			sessionSpan?.end();
		} finally {
			await shutdown();
		}

		const spans = telemetryState.finishedSpans as TelemetrySpan[];
		expect(spans).toHaveLength(4);

		const sessionReadable = findSpan(spans, `session:${sessionId}`);
		const turnReadable = findSpan(spans, `turn:${turnIndex}`);
		const llmReadable = findSpan(spans, "llm-call");
		const toolReadable = findSpan(spans, "tool:mock-tool");

		expect(turnReadable.parentSpanContext?.spanId).toBe(sessionReadable.spanContext().spanId);
		expect(llmReadable.parentSpanContext?.spanId).toBe(turnReadable.spanContext().spanId);
		expect(toolReadable.parentSpanContext?.spanId).toBe(turnReadable.spanContext().spanId);

		expect(sessionReadable.attributes["session.id"]).toBe(sessionId);
		expect(turnReadable.attributes["session.id"]).toBe(sessionId);
		expect(turnReadable.attributes["turn.index"]).toBe(turnIndex);

		expect(llmReadable.attributes["gen_ai.request.model"]).toBe(model.id);
		expect(llmReadable.attributes["gen_ai.request.provider"]).toBe(model.provider);
		expect(llmReadable.attributes["session.id"]).toBe(sessionId);
		expect(llmReadable.attributes["gen_ai.usage.input_tokens"]).toBe(17);
		expect(llmReadable.attributes["gen_ai.usage.output_tokens"]).toBe(9);
		expect(llmReadable.attributes["gen_ai.usage.cache_read.input_tokens"]).toBe(0);
		expect(llmReadable.attributes["gen_ai.usage.cache_creation.input_tokens"]).toBe(0);
		expect(llmReadable.attributes["gen_ai.cost.total"]).toBe(0.03);

		expect(toolReadable.attributes["tool.name"]).toBe("mock-tool");
		expect(toolReadable.attributes["tool.call_id"]).toBe("tool-call-1");
		expect(toolReadable.attributes["tool.is_error"]).toBe(false);

		expect(sessionReadable.ended).toBe(true);
		expect(turnReadable.ended).toBe(true);
		expect(llmReadable.ended).toBe(true);
		expect(toolReadable.ended).toBe(true);

		expect(toNanos(sessionReadable.startTime)).toBeLessThanOrEqual(toNanos(turnReadable.startTime));
		expect(toNanos(turnReadable.startTime)).toBeLessThanOrEqual(toNanos(llmReadable.startTime));
		expect(toNanos(llmReadable.endTime)).toBeLessThanOrEqual(toNanos(toolReadable.startTime));
	});

	it("should end spans and record llm errors", async () => {
		const shutdown = initCodingAgentTelemetry({
			enabled: true,
			secretKey: "test-secret",
			publicKey: "test-public",
		});

		const sessionId = "session-e2e-error";
		const model: Model<typeof MOCK_API> = {
			id: "mock-model-v1",
			name: "Mock Model",
			api: MOCK_API,
			provider: MOCK_PROVIDER,
			baseUrl: "http://localhost:3000/mock",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 8000,
			maxTokens: 2000,
		};

		try {
			const sessionSpan = startSessionSpan(sessionId);
			const turnSpan = context.with(trace.setSpan(context.active(), sessionSpan!), () =>
				startTurnSpan(sessionId, 0),
			);

			const llmEventStream = context.with(trace.setSpan(context.active(), turnSpan!), () =>
				stream(
					model,
					{
						messages: [{ role: "user", content: "force-error", timestamp: Date.now() }],
					},
					{ sessionId },
				),
			);

			const llmMessage = await llmEventStream.result();
			expect(llmMessage.stopReason).toBe("error");
			expect(llmMessage.errorMessage).toContain("mock provider failure");

			turnSpan?.end();
			sessionSpan?.end();
		} finally {
			await shutdown();
		}

		const spans = telemetryState.finishedSpans as TelemetrySpan[];
		const llmReadable = findSpan(spans, "llm-call");
		expect(llmReadable.ended).toBe(true);
		expect(llmReadable.events.some((event) => event.name === "exception")).toBe(true);
		expect(llmReadable.attributes["session.id"]).toBe(sessionId);
	});
});
