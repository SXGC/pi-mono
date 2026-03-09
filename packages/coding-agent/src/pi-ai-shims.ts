import type { AssistantMessageEvent, Context, Model, SimpleStreamOptions, StreamOptions } from "@mariozechner/pi-ai";

type BedrockProviderModule = {
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
};

declare module "@mariozechner/pi-ai" {
	export function setBedrockProviderModule(module: BedrockProviderModule): void;
}

declare module "@mariozechner/pi-ai/bedrock-provider" {
	export const bedrockProviderModule: BedrockProviderModule;
}
