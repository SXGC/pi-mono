import type {
	AssistantMessage,
	AssistantMessageEvent,
	Context,
	Model,
	SimpleStreamOptions,
	StreamOptions,
} from "./types.js";
import { AssistantMessageEventStream } from "./utils/event-stream.js";

interface BedrockProviderModule {
	streamBedrock: (
		model: Model<"bedrock-converse-stream">,
		context: Context,
		options?: StreamOptions,
	) => AsyncIterable<AssistantMessageEvent>;
	streamSimpleBedrock: (
		model: Model<"bedrock-converse-stream">,
		context: Context,
		options?: SimpleStreamOptions,
	) => AsyncIterable<AssistantMessageEvent>;
}

type DynamicImport = (specifier: string) => Promise<unknown>;

const dynamicImport: DynamicImport = (specifier) => import(specifier);
const BEDROCK_PROVIDER_SPECIFIER = "./providers/amazon-" + "bedrock.js";

async function loadBedrockProviderModule(): Promise<BedrockProviderModule> {
	const module = await dynamicImport(BEDROCK_PROVIDER_SPECIFIER);
	return module as BedrockProviderModule;
}

function forwardStream(target: AssistantMessageEventStream, source: AsyncIterable<AssistantMessageEvent>): void {
	(async () => {
		for await (const event of source) {
			target.push(event);
		}
		target.end();
	})();
}

function createLazyLoadErrorMessage(model: Model<"bedrock-converse-stream">, error: unknown): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "bedrock-converse-stream",
		provider: model.provider,
		model: model.id,
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
	};
}

export function streamBedrock(
	model: Model<"bedrock-converse-stream">,
	context: Context,
	options?: StreamOptions,
): AssistantMessageEventStream {
	const outer = new AssistantMessageEventStream();

	loadBedrockProviderModule()
		.then((module) => {
			const inner = module.streamBedrock(model, context, options);
			forwardStream(outer, inner);
		})
		.catch((error) => {
			const message = createLazyLoadErrorMessage(model, error);
			outer.push({ type: "error", reason: "error", error: message });
			outer.end(message);
		});

	return outer;
}

export function streamSimpleBedrock(
	model: Model<"bedrock-converse-stream">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const outer = new AssistantMessageEventStream();

	loadBedrockProviderModule()
		.then((module) => {
			const inner = module.streamSimpleBedrock(model, context, options);
			forwardStream(outer, inner);
		})
		.catch((error) => {
			const message = createLazyLoadErrorMessage(model, error);
			outer.push({ type: "error", reason: "error", error: message });
			outer.end(message);
		});

	return outer;
}

export const bedrockProviderModule = {
	streamBedrock,
	streamSimpleBedrock,
};
