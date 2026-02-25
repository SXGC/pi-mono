import type { Api, Model } from "@mariozechner/pi-ai";
import { describe, expect, test, vi } from "vitest";
import { type BuiltinCommandRuntime, tryBuiltinCommand } from "../../src/core/command-dispatcher.js";
import { isBuiltinCommand, parseSlashCommand } from "../../src/core/command-parser.js";
import { findExactModelMatch, findModelCandidates } from "../../src/core/model-matcher.js";
import type { ModelRegistry } from "../../src/core/model-registry.js";

// Mock models for testing
const mockModels: Model<Api>[] = [
	{
		id: "claude-sonnet-4-5",
		name: "Claude Sonnet 4.5",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200000,
		maxTokens: 8192,
	},
	{
		id: "gpt-4o",
		name: "GPT-4o",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://api.openai.com",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 5, output: 15, cacheRead: 0.5, cacheWrite: 5 },
		contextWindow: 128000,
		maxTokens: 4096,
	},
	{
		id: "claude-opus-4-6",
		name: "Claude Opus 4.6",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
		contextWindow: 200000,
		maxTokens: 16384,
	},
];

// Create a mock ModelRegistry
function createMockModelRegistry(models: Model<Api>[] = mockModels): ModelRegistry {
	return {
		getAvailable: () => models,
		getAll: () => models,
		find: (provider: string, modelId: string) => models.find((m) => m.provider === provider && m.id === modelId),
	} as unknown as ModelRegistry;
}

describe("parseSlashCommand", () => {
	test("empty string returns null", () => {
		expect(parseSlashCommand("")).toBeNull();
	});

	test("non-command text returns null", () => {
		expect(parseSlashCommand("hello world")).toBeNull();
		expect(parseSlashCommand("not a command")).toBeNull();
		expect(parseSlashCommand("  /not at start")).toBeNull();
	});

	test("/model returns { name: 'model', args: '' }", () => {
		const result = parseSlashCommand("/model");
		expect(result).toEqual({ name: "model", args: "" });
	});

	test("/model claude returns { name: 'model', args: 'claude' }", () => {
		const result = parseSlashCommand("/model claude");
		expect(result).toEqual({ name: "model", args: "claude" });
	});

	test("/model with multiple args preserves full args string", () => {
		const result = parseSlashCommand("/model claude sonnet");
		expect(result).toEqual({ name: "model", args: "claude sonnet" });
	});

	test("/new returns { name: 'new', args: '' }", () => {
		const result = parseSlashCommand("/new");
		expect(result).toEqual({ name: "new", args: "" });
	});

	test("trims input whitespace", () => {
		// parseSlashCommand trims the input before parsing
		const result = parseSlashCommand("/model gpt-4o  ");
		expect(result).toEqual({ name: "model", args: "gpt-4o" });
	});

	test("command name is case-sensitive (lowercase preserved)", () => {
		const result = parseSlashCommand("/MODEL");
		expect(result).toEqual({ name: "MODEL", args: "" });
	});
});

describe("isBuiltinCommand", () => {
	test("'model' returns true", () => {
		expect(isBuiltinCommand("model")).toBe(true);
	});

	test("'new' returns true", () => {
		expect(isBuiltinCommand("new")).toBe(true);
	});

	test("'settings' returns true", () => {
		expect(isBuiltinCommand("settings")).toBe(true);
	});

	test("'quit' returns true", () => {
		expect(isBuiltinCommand("quit")).toBe(true);
	});

	test("'unknown' returns false", () => {
		expect(isBuiltinCommand("unknown")).toBe(false);
	});

	test("'foo' returns false", () => {
		expect(isBuiltinCommand("foo")).toBe(false);
	});

	test("empty string returns false", () => {
		expect(isBuiltinCommand("")).toBe(false);
	});

	test("case-sensitive check", () => {
		expect(isBuiltinCommand("MODEL")).toBe(false);
		expect(isBuiltinCommand("Model")).toBe(false);
	});
});

describe("findExactModelMatch", () => {
	test("exact match by model id", () => {
		const registry = createMockModelRegistry();
		const result = findExactModelMatch("gpt-4o", registry);
		expect(result).toBeDefined();
		expect(result?.id).toBe("gpt-4o");
		expect(result?.provider).toBe("openai");
	});

	test("exact match with provider/modelId format", () => {
		const registry = createMockModelRegistry();
		const result = findExactModelMatch("openai/gpt-4o", registry);
		expect(result).toBeDefined();
		expect(result?.id).toBe("gpt-4o");
		expect(result?.provider).toBe("openai");
	});

	test("provider prefix filters results", () => {
		const registry = createMockModelRegistry();
		// claude-sonnet-4-5 exists in anthropic provider
		const result = findExactModelMatch("anthropic/claude-sonnet-4-5", registry);
		expect(result).toBeDefined();
		expect(result?.id).toBe("claude-sonnet-4-5");
		expect(result?.provider).toBe("anthropic");
	});

	test("wrong provider prefix returns undefined", () => {
		const registry = createMockModelRegistry();
		// gpt-4o is openai, not anthropic
		const result = findExactModelMatch("anthropic/gpt-4o", registry);
		expect(result).toBeUndefined();
	});

	test("no match returns undefined", () => {
		const registry = createMockModelRegistry();
		const result = findExactModelMatch("nonexistent-model", registry);
		expect(result).toBeUndefined();
	});

	test("empty string returns undefined", () => {
		const registry = createMockModelRegistry();
		const result = findExactModelMatch("", registry);
		expect(result).toBeUndefined();
	});

	test("only provider without model id returns undefined", () => {
		const registry = createMockModelRegistry();
		const result = findExactModelMatch("openai/", registry);
		expect(result).toBeUndefined();
	});

	test("case-insensitive matching", () => {
		const registry = createMockModelRegistry();
		const result = findExactModelMatch("GPT-4O", registry);
		expect(result).toBeDefined();
		expect(result?.id).toBe("gpt-4o");
	});

	test("case-insensitive provider matching", () => {
		const registry = createMockModelRegistry();
		const result = findExactModelMatch("OPENAI/gpt-4o", registry);
		expect(result).toBeDefined();
		expect(result?.id).toBe("gpt-4o");
	});

	test("ambiguous match (multiple models with same id in different providers) returns undefined", () => {
		// Create models with same id but different providers
		const ambiguousModels: Model<Api>[] = [
			{ ...mockModels[1], id: "shared-model", provider: "openai" },
			{ ...mockModels[1], id: "shared-model", provider: "anthropic" },
		];
		const registry = createMockModelRegistry(ambiguousModels);
		const result = findExactModelMatch("shared-model", registry);
		// Multiple matches -> undefined (ambiguous)
		expect(result).toBeUndefined();
	});

	test("ambiguous resolved with provider prefix", () => {
		const ambiguousModels: Model<Api>[] = [
			{ ...mockModels[1], id: "shared-model", provider: "openai" },
			{ ...mockModels[1], id: "shared-model", provider: "anthropic" },
		];
		const registry = createMockModelRegistry(ambiguousModels);
		const result = findExactModelMatch("anthropic/shared-model", registry);
		expect(result).toBeDefined();
		expect(result?.provider).toBe("anthropic");
	});
});

describe("findModelCandidates", () => {
	test("finds models containing search term in id", () => {
		const registry = createMockModelRegistry();
		const results = findModelCandidates("claude", registry);
		expect(results.length).toBeGreaterThan(0);
		expect(
			results.every((m) => m.id.toLowerCase().includes("claude") || m.provider.toLowerCase().includes("claude")),
		).toBe(true);
	});

	test("finds models containing search term in provider", () => {
		const registry = createMockModelRegistry();
		const results = findModelCandidates("openai", registry);
		expect(results.length).toBeGreaterThan(0);
		expect(results.some((m) => m.provider === "openai")).toBe(true);
	});

	test("respects limit parameter", () => {
		const registry = createMockModelRegistry();
		const results = findModelCandidates("a", registry, 2);
		expect(results.length).toBeLessThanOrEqual(2);
	});

	test("returns empty array for no matches", () => {
		const registry = createMockModelRegistry();
		const results = findModelCandidates("xyznonexistent123", registry);
		expect(results).toEqual([]);
	});

	test("case-insensitive search", () => {
		const registry = createMockModelRegistry();
		const results = findModelCandidates("CLAUDE", registry);
		expect(results.length).toBeGreaterThan(0);
	});

	test("empty search term returns limited results", () => {
		const registry = createMockModelRegistry();
		// Empty string is contained in all strings
		const results = findModelCandidates("", registry);
		expect(results.length).toBeLessThanOrEqual(5); // default limit
	});
});

describe("tryBuiltinCommand", () => {
	function createMockRuntime(overrides: Partial<BuiltinCommandRuntime> = {}): BuiltinCommandRuntime {
		return {
			modelRegistry: createMockModelRegistry(),
			currentModel: mockModels[0],
			setModel: vi.fn().mockResolvedValue(undefined),
			newSession: vi.fn().mockResolvedValue(true),
			isStreaming: false,
			abort: vi.fn().mockResolvedValue(undefined),
			showStatus: vi.fn(),
			showError: vi.fn(),
			...overrides,
		};
	}

	describe("/model command", () => {
		test("no args returns current model status", async () => {
			const runtime = createMockRuntime();
			const result = await tryBuiltinCommand("model", "", runtime);

			expect(result.handled).toBe(true);
			expect(result.success).toBe(true);
			expect(result.message).toContain("Current model:");
		});

		test("no args with no current model shows available count", async () => {
			const runtime = createMockRuntime({ currentModel: undefined });
			const result = await tryBuiltinCommand("model", "", runtime);

			expect(result.handled).toBe(true);
			expect(result.success).toBe(true);
			expect(result.message).toContain("No model selected");
		});

		test("successful model switch", async () => {
			const setModel = vi.fn().mockResolvedValue(undefined);
			const runtime = createMockRuntime({ setModel });
			const result = await tryBuiltinCommand("model", "gpt-4o", runtime);

			expect(result.handled).toBe(true);
			expect(result.success).toBe(true);
			expect(result.message).toContain("Switched model to openai/gpt-4o");
			expect(setModel).toHaveBeenCalledTimes(1);
		});

		test("successful model switch with provider prefix", async () => {
			const setModel = vi.fn().mockResolvedValue(undefined);
			const runtime = createMockRuntime({ setModel });
			const result = await tryBuiltinCommand("model", "openai/gpt-4o", runtime);

			expect(result.handled).toBe(true);
			expect(result.success).toBe(true);
			expect(result.message).toContain("Switched model to openai/gpt-4o");
		});

		test("model not found with candidates suggests alternatives", async () => {
			const runtime = createMockRuntime();
			// 'sonnet' matches 'claude-sonnet-4-5' but is not an exact match
			const result = await tryBuiltinCommand("model", "sonnet", runtime);

			expect(result.handled).toBe(true);
			expect(result.success).toBe(false);
			// When candidates exist, shows "No exact match" with suggestions
			expect(result.message).toContain("No exact match");
		});

		test("model not found with no candidates", async () => {
			const runtime = createMockRuntime();
			const result = await tryBuiltinCommand("model", "xyz123notfound", runtime);

			expect(result.handled).toBe(true);
			expect(result.success).toBe(false);
			expect(result.message).toContain("No model found matching");
		});

		test("setModel error is handled", async () => {
			const setModel = vi.fn().mockRejectedValue(new Error("API error"));
			const runtime = createMockRuntime({ setModel });
			const result = await tryBuiltinCommand("model", "gpt-4o", runtime);

			expect(result.handled).toBe(true);
			expect(result.success).toBe(false);
			expect(result.error).toBe("API error");
		});
	});

	describe("/new command", () => {
		test("successful new session", async () => {
			const newSession = vi.fn().mockResolvedValue(true);
			const runtime = createMockRuntime({ newSession });
			const result = await tryBuiltinCommand("new", "", runtime);

			expect(result.handled).toBe(true);
			expect(result.success).toBe(true);
			expect(result.message).toBe("New session started");
			expect(newSession).toHaveBeenCalledTimes(1);
		});

		test("with args returns error", async () => {
			const runtime = createMockRuntime();
			const result = await tryBuiltinCommand("new", "unexpected args", runtime);

			expect(result.handled).toBe(true);
			expect(result.success).toBe(false);
			expect(result.message).toBe("Usage: /new (no arguments)");
		});

		test("aborts streaming before new session", async () => {
			const abort = vi.fn().mockResolvedValue(undefined);
			const newSession = vi.fn().mockResolvedValue(true);
			const runtime = createMockRuntime({ isStreaming: true, abort, newSession });
			const result = await tryBuiltinCommand("new", "", runtime);

			expect(result.handled).toBe(true);
			expect(result.success).toBe(true);
			expect(abort).toHaveBeenCalledTimes(1);
			expect(newSession).toHaveBeenCalledTimes(1);
		});

		test("handles newSession returning false (cancelled by extension)", async () => {
			const newSession = vi.fn().mockResolvedValue(false);
			const runtime = createMockRuntime({ newSession });
			const result = await tryBuiltinCommand("new", "", runtime);

			expect(result.handled).toBe(true);
			expect(result.success).toBe(false);
			expect(result.message).toBe("New session cancelled by extension");
		});

		test("handles newSession error", async () => {
			const newSession = vi.fn().mockRejectedValue(new Error("Session error"));
			const runtime = createMockRuntime({ newSession });
			const result = await tryBuiltinCommand("new", "", runtime);

			expect(result.handled).toBe(true);
			expect(result.success).toBe(false);
			expect(result.error).toBe("Session error");
		});
	});

	describe("unknown commands", () => {
		test("unknown command returns handled: false", async () => {
			const runtime = createMockRuntime();
			const result = await tryBuiltinCommand("unknown", "", runtime);

			expect(result.handled).toBe(false);
		});

		test("empty command name returns handled: false", async () => {
			const runtime = createMockRuntime();
			const result = await tryBuiltinCommand("", "", runtime);

			expect(result.handled).toBe(false);
		});
	});

	describe("case handling", () => {
		test("command name is case-insensitive", async () => {
			const runtime = createMockRuntime();
			const result = await tryBuiltinCommand("MODEL", "", runtime);

			expect(result.handled).toBe(true);
			expect(result.success).toBe(true);
		});

		test("command name with whitespace is trimmed", async () => {
			const runtime = createMockRuntime();
			const result = await tryBuiltinCommand("  model  ", "", runtime);

			expect(result.handled).toBe(true);
			expect(result.success).toBe(true);
		});
	});
});
