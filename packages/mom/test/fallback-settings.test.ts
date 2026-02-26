/**
 * Tests for FallbackSettings in MomSettingsManager.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MomSettingsManager } from "../src/context.js";

describe("MomSettingsManager FallbackSettings", () => {
	let tempDir: string;
	let settingsManager: MomSettingsManager;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-mom-fallback-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
		settingsManager = new MomSettingsManager(tempDir);
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	describe("getFallbackEnabled", () => {
		it("should return false by default", () => {
			expect(settingsManager.getFallbackEnabled()).toBe(false);
		});

		it("should return true when enabled", () => {
			settingsManager.setFallbackEnabled(true);
			expect(settingsManager.getFallbackEnabled()).toBe(true);
		});

		it("should return false when disabled", () => {
			settingsManager.setFallbackEnabled(true);
			settingsManager.setFallbackEnabled(false);
			expect(settingsManager.getFallbackEnabled()).toBe(false);
		});
	});

	describe("setFallbackEnabled", () => {
		it("should persist enabled state", () => {
			settingsManager.setFallbackEnabled(true);

			// Create new instance to test persistence
			const newManager = new MomSettingsManager(tempDir);
			expect(newManager.getFallbackEnabled()).toBe(true);
		});

		it("should persist disabled state", () => {
			settingsManager.setFallbackEnabled(true);
			settingsManager.setFallbackEnabled(false);

			const newManager = new MomSettingsManager(tempDir);
			expect(newManager.getFallbackEnabled()).toBe(false);
		});
	});

	describe("getFallbackModels", () => {
		it("should return undefined by default", () => {
			expect(settingsManager.getFallbackModels()).toBeUndefined();
		});

		it("should return configured models", () => {
			const models = [
				{ provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
				{ provider: "openai", modelId: "gpt-4o" },
			];
			settingsManager.setFallbackModels(models);
			expect(settingsManager.getFallbackModels()).toEqual(models);
		});
	});

	describe("setFallbackModels", () => {
		it("should persist models", () => {
			const models = [
				{ provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
				{ provider: "openai", modelId: "gpt-4o" },
			];
			settingsManager.setFallbackModels(models);

			const newManager = new MomSettingsManager(tempDir);
			expect(newManager.getFallbackModels()).toEqual(models);
		});

		it("should allow clearing models", () => {
			settingsManager.setFallbackModels([{ provider: "test", modelId: "test" }]);
			settingsManager.setFallbackModels(undefined);

			expect(settingsManager.getFallbackModels()).toBeUndefined();
		});
	});

	describe("getFallbackOnExhausted", () => {
		it("should return 'error' by default", () => {
			expect(settingsManager.getFallbackOnExhausted()).toBe("error");
		});

		it("should return 'ask' when configured", () => {
			settingsManager.setFallbackOnExhausted("ask");
			expect(settingsManager.getFallbackOnExhausted()).toBe("ask");
		});
	});

	describe("setFallbackOnExhausted", () => {
		it("should persist 'ask' action", () => {
			settingsManager.setFallbackOnExhausted("ask");

			const newManager = new MomSettingsManager(tempDir);
			expect(newManager.getFallbackOnExhausted()).toBe("ask");
		});

		it("should persist 'error' action", () => {
			settingsManager.setFallbackOnExhausted("ask");
			settingsManager.setFallbackOnExhausted("error");

			const newManager = new MomSettingsManager(tempDir);
			expect(newManager.getFallbackOnExhausted()).toBe("error");
		});
	});

	describe("getFallbackSettings", () => {
		it("should return default settings", () => {
			const settings = settingsManager.getFallbackSettings();
			expect(settings).toEqual({
				enabled: false,
				models: undefined,
				onFallbackExhausted: "error",
			});
		});

		it("should return configured settings", () => {
			settingsManager.setFallbackEnabled(true);
			settingsManager.setFallbackModels([{ provider: "openai", modelId: "gpt-4o" }]);
			settingsManager.setFallbackOnExhausted("ask");

			const settings = settingsManager.getFallbackSettings();
			expect(settings).toEqual({
				enabled: true,
				models: [{ provider: "openai", modelId: "gpt-4o" }],
				onFallbackExhausted: "ask",
			});
		});
	});
});
