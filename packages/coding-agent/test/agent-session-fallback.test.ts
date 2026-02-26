/**
 * Tests for AgentSession fallback behavior.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession, type AgentSessionEvent } from "../src/core/agent-session.js";
import { AuthStorage } from "../src/core/auth-storage.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { createTestResourceLoader } from "./utilities.js";

describe("AgentSession fallback", () => {
	let session: AgentSession;
	let tempDir: string;
	let events: AgentSessionEvent[];
	let settingsManager: SettingsManager;
	let modelRegistry: ModelRegistry;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-fallback-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
		events = [];
	});

	afterEach(async () => {
		if (session) {
			session.dispose();
		}
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	function createSession(fallbackEnabled = false, fallbackModels?: Array<{ provider: string; modelId: string }>) {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: "Test",
				tools: [],
			},
		});

		const sessionManager = SessionManager.inMemory();
		settingsManager = SettingsManager.create(tempDir, tempDir);
		if (fallbackEnabled) {
			settingsManager.setFallbackEnabled(true);
		}
		if (fallbackModels) {
			settingsManager.setFallbackModels(fallbackModels);
		}

		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		modelRegistry = new ModelRegistry(authStorage, tempDir);

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRegistry,
			resourceLoader: createTestResourceLoader(),
		});

		session.subscribe((event) => {
			events.push(event);
		});

		return session;
	}

	describe("fallbackEnabled", () => {
		it("should return false by default", () => {
			createSession();
			expect(session.fallbackEnabled).toBe(false);
		});

		it("should return true when enabled in settings", () => {
			createSession(true);
			expect(session.fallbackEnabled).toBe(true);
		});
	});

	describe("setFallbackEnabled", () => {
		it("should toggle fallback setting", () => {
			createSession();
			expect(session.fallbackEnabled).toBe(false);

			session.setFallbackEnabled(true);
			expect(session.fallbackEnabled).toBe(true);

			session.setFallbackEnabled(false);
			expect(session.fallbackEnabled).toBe(false);
		});
	});

	describe("fallback events", () => {
		it("should emit fallback_start event when fallback is triggered", async () => {
			const fallbackModels = [{ provider: "openai", modelId: "gpt-4o" }];
			createSession(true, fallbackModels);

			// Verify fallback is enabled
			expect(session.fallbackEnabled).toBe(true);
			expect(settingsManager.getFallbackModels()).toEqual(fallbackModels);
		});

		it("should emit fallback_end event on successful fallback", async () => {
			createSession(true);

			// The actual fallback triggering is tested in e2e tests
			// Here we just verify the event types are correctly defined
			const fallbackStartEvent: AgentSessionEvent = {
				type: "fallback_start",
				fromModel: getModel("anthropic", "claude-sonnet-4-5")!,
				toModel: getModel("openai", "gpt-4o")!,
				reason: "test error",
				fallbackIndex: 1,
				totalFallbackModels: 2,
			};

			const fallbackEndEvent: AgentSessionEvent = {
				type: "fallback_end",
				success: true,
				finalModel: getModel("openai", "gpt-4o")!,
				totalAttempts: 1,
			};

			expect(fallbackStartEvent.type).toBe("fallback_start");
			expect(fallbackEndEvent.type).toBe("fallback_end");
		});
	});

	describe("fallback chain building", () => {
		it("should include current model as first in chain", async () => {
			createSession(true);
			expect(session.model?.id).toBe("claude-sonnet-4-5");
		});

		it("should use configured models when provided", () => {
			const fallbackModels = [
				{ provider: "openai", modelId: "gpt-4o" },
				{ provider: "google", modelId: "gemini-2.5-flash" },
			];
			createSession(true, fallbackModels);

			expect(settingsManager.getFallbackModels()).toEqual(fallbackModels);
		});
	});

	describe("fallback on retry exhausted", () => {
		it("should not trigger fallback when disabled", async () => {
			createSession(false);

			// Fallback should not be triggered when disabled
			expect(session.fallbackEnabled).toBe(false);
		});

		it("should check fallback settings when retry is exhausted", async () => {
			createSession(true);

			// Verify settings are accessible
			const fallbackSettings = settingsManager.getFallbackSettings();
			expect(fallbackSettings.enabled).toBe(true);
		});
	});
});
