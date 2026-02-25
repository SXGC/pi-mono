# Adding New Models

This guide explains how to add new LLM models to the pi-ai package.

## Overview

The model system consists of two main components:

1. **`scripts/generate-models.ts`** - Generator script that fetches model data from external sources and produces the model registry
2. **`src/models.generated.ts`** - Auto-generated TypeScript file containing the `MODELS` constant

> **Important**: Never manually edit `src/models.generated.ts`. Your changes will be overwritten when the generator runs. Always modify `scripts/generate-models.ts` instead.

## Adding a New Provider

### Step 1: Add Provider Type

Add the provider name to `KnownProvider` in `src/types.ts`:

```typescript
export type KnownProvider =
	| "amazon-bedrock"
	| "anthropic"
	// ... other providers
	| "your-new-provider";  // Add here
```

### Step 2: Add API Key Mapping (if needed)

If the provider requires an API key, add the environment variable mapping in `src/env-api-keys.ts`:

```typescript
const API_KEY_ENV_VARS: Record<string, string> = {
	// ... existing mappings
	"your-new-provider": "YOUR_PROVIDER_API_KEY",
};
```

### Step 3: Add Models to Generator

Edit `scripts/generate-models.ts` to include your provider's models.

#### Option A: If the provider is on models.dev

Add a processing block similar to existing providers:

```typescript
// Process YourProvider models
if (data["your-provider"]?.models) {
	for (const [modelId, model] of Object.entries(data["your-provider"].models)) {
		const m = model as ModelsDevModel;
		if (m.tool_call !== true) continue;  // Only include tool-capable models

		models.push({
			id: modelId,
			name: m.name || modelId,
			api: "openai-completions",  // or appropriate API type
			provider: "your-new-provider",
			baseUrl: "https://api.your-provider.com/v1",
			reasoning: m.reasoning === true,
			input: m.modalities?.input?.includes("image") 
				? ["text", "image"] 
				: ["text"],
			cost: {
				input: m.cost?.input || 0,
				output: m.cost?.output || 0,
				cacheRead: m.cost?.cache_read || 0,
				cacheWrite: m.cost?.cache_write || 0,
			},
			contextWindow: m.limit?.context || 4096,
			maxTokens: m.limit?.output || 4096,
		});
	}
}
```

#### Option B: If you need to clone an existing provider with a different endpoint

Use the same data source but with a different `provider` and `baseUrl`:

```typescript
// Process YourProvider models (same models as ExistingProvider, different endpoint)
if (data.existingProvider?.models) {
	for (const [modelId, model] of Object.entries(data.existingProvider.models)) {
		const m = model as ModelsDevModel;
		if (m.tool_call !== true) continue;
		const supportsImage = m.modalities?.input?.includes("image");

		models.push({
			id: modelId,
			name: m.name || modelId,
			api: "openai-completions",
			provider: "your-new-provider",
			baseUrl: "https://your-alternative-endpoint.com/v1",
			reasoning: m.reasoning === true,
			input: supportsImage ? ["text", "image"] : ["text"],
			cost: {
				input: m.cost?.input || 0,
				output: m.cost?.output || 0,
				cacheRead: m.cost?.cache_read || 0,
				cacheWrite: m.cost?.cache_write || 0,
			},
			compat: {
				// Add compatibility settings if needed
				supportsDeveloperRole: false,
			},
			contextWindow: m.limit?.context || 4096,
			maxTokens: m.limit?.output || 4096,
		});
	}
}
```

#### Option C: If adding models manually (not on models.dev)

Define a static array and push to `allModels`:

```typescript
const yourProviderModels: Model<"openai-completions">[] = [
	{
		id: "model-id",
		name: "Model Name",
		api: "openai-completions",
		provider: "your-new-provider",
		baseUrl: "https://api.your-provider.com/v1",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 1.0, output: 2.0, cacheRead: 0.1, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
	},
	// ... more models
];
allModels.push(...yourProviderModels);
```

### Step 4: Run the Generator

```bash
cd packages/ai
pnpm generate-models
```

This will regenerate `src/models.generated.ts` with your new models.

### Step 5: Verify

```bash
pnpm check
```

## Example: Adding zAI Coding Plan

This example shows how to add a provider that uses the same models as an existing provider but with a different API endpoint:

```typescript
// In scripts/generate-models.ts, after the zAI processing block:

// Process zAI Coding Plan models (same models as zAI, different endpoint)
if (data.zai?.models) {
	for (const [modelId, model] of Object.entries(data.zai.models)) {
		const m = model as ModelsDevModel;
		if (m.tool_call !== true) continue;
		const supportsImage = m.modalities?.input?.includes("image");

		models.push({
			id: modelId,
			name: m.name || modelId,
			api: "openai-completions",
			provider: "zai-coding-plan",
			baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
			reasoning: m.reasoning === true,
			input: supportsImage ? ["text", "image"] : ["text"],
			cost: {
				input: m.cost?.input || 0,
				output: m.cost?.output || 0,
				cacheRead: m.cost?.cache_read || 0,
				cacheWrite: m.cost?.cache_write || 0,
			},
			compat: {
				supportsDeveloperRole: false,
				thinkingFormat: "zai",
			},
			contextWindow: m.limit?.context || 4096,
			maxTokens: m.limit?.output || 4096,
		});
	}
}
```

## Model Interface Reference

```typescript
interface Model<TApi extends Api> {
	id: string;                    // Model identifier (e.g., "gpt-4o")
	name: string;                  // Display name (e.g., "GPT-4o")
	api: TApi;                     // API type (e.g., "openai-completions")
	provider: Provider;            // Provider name (e.g., "openai")
	baseUrl: string;               // API endpoint URL
	reasoning: boolean;            // Whether the model supports reasoning/thinking
	input: ("text" | "image")[];   // Supported input modalities
	cost: {
		input: number;             // $/million tokens
		output: number;            // $/million tokens
		cacheRead: number;         // $/million tokens (prompt cache read)
		cacheWrite: number;        // $/million tokens (prompt cache write)
	};
	contextWindow: number;        // Maximum context length in tokens
	maxTokens: number;            // Maximum output tokens
	headers?: Record<string, string>;  // Optional custom headers
	compat?: OpenAICompletionsCompat | OpenAIResponsesCompat;  // Compatibility settings
}
```

## API Types

The `api` field determines which provider implementation handles the request:

| API Type | Description |
|----------|-------------|
| `openai-completions` | OpenAI Chat Completions API (also used by compatible providers) |
| `openai-responses` | OpenAI Responses API |
| `anthropic-messages` | Anthropic Messages API |
| `google-generative-ai` | Google Generative AI API |
| `google-vertex` | Google Vertex AI API |
| `bedrock-converse-stream` | Amazon Bedrock Converse API |

## Compatibility Settings

For OpenAI-compatible providers that have slight differences, use the `compat` field:

```typescript
compat: {
	supportsStore?: boolean;           // Supports `store` field (default: auto-detected)
	supportsDeveloperRole?: boolean;   // Supports `developer` role vs `system`
	supportsReasoningEffort?: boolean; // Supports `reasoning_effort` parameter
	supportsUsageInStreaming?: boolean; // Supports usage in streaming responses
	maxTokensField?: "max_completion_tokens" | "max_tokens";
	thinkingFormat?: "openai" | "zai" | "qwen";  // Reasoning parameter format
	// ... see types.ts for full list
}
```

## Troubleshooting

### Models not appearing after generation

1. Check that `tool_call !== true` filter isn't excluding your models
2. Verify the provider key in `data` matches what models.dev returns
3. Check for duplicate model IDs (later additions are skipped)

### Type errors after generation

1. Ensure the provider is added to `KnownProvider` in `types.ts`
2. Check that the `api` value is a valid `KnownApi`
3. Run `pnpm check` to see specific errors

### Runtime errors when using the model

1. Verify `baseUrl` is correct
2. Check that the API key environment variable is set
3. Ensure the API type matches the provider's actual API
