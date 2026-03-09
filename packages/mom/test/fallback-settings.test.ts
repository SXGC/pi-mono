import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "@mariozechner/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMomRuntimeSettings, createMomSettingsManager, type MomRuntimeSettings } from "../src/context.js";

describe("mom workspace settings integration", () => {
	let tempDir: string;
	let settingsManager: SettingsManager;
	let runtimeSettings: MomRuntimeSettings;
	let originalMomLogLevel: string | undefined;
	let originalExistingVar: string | undefined;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-mom-settings-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
		settingsManager = createMomSettingsManager(tempDir);
		runtimeSettings = createMomRuntimeSettings(tempDir);
		originalMomLogLevel = process.env.MOM_LOG_LEVEL;
		originalExistingVar = process.env.EXISTING_ENV;
		delete process.env.MOM_LOG_LEVEL;
		delete process.env.EXISTING_ENV;
		delete process.env.FROM_SETTINGS;
	});

	afterEach(async () => {
		await settingsManager.flush();
		if (originalMomLogLevel === undefined) {
			delete process.env.MOM_LOG_LEVEL;
		} else {
			process.env.MOM_LOG_LEVEL = originalMomLogLevel;
		}
		if (originalExistingVar === undefined) {
			delete process.env.EXISTING_ENV;
		} else {
			process.env.EXISTING_ENV = originalExistingVar;
		}
		delete process.env.FROM_SETTINGS;
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	function readSettingsFile(): Record<string, unknown> {
		return JSON.parse(readFileSync(join(tempDir, "settings.json"), "utf-8")) as Record<string, unknown>;
	}

	it("returns a real SettingsManager for AgentSession", () => {
		expect(settingsManager).toBeInstanceOf(SettingsManager);
	});

	it("persists shared and mom-only settings into the same workspace file", async () => {
		settingsManager.setFallbackEnabled(true);
		settingsManager.setFallbackModels([{ provider: "openai", modelId: "gpt-4o" }]);
		runtimeSettings.setResponseSettings({ mention: false, channel: true });
		runtimeSettings.setObsidianPath("/vault/main");
		runtimeSettings.setLogLevel("debug");

		await settingsManager.flush();

		const persisted = readSettingsFile();
		expect(persisted.fallback).toEqual({
			enabled: true,
			models: [{ provider: "openai", modelId: "gpt-4o" }],
		});
		expect(persisted.response).toEqual({ mention: false, channel: true });
		expect(persisted.obsidianPath).toBe("/vault/main");
		expect(persisted.env).toEqual({ MOM_LOG_LEVEL: "debug" });

		const reloadedRuntimeSettings = createMomRuntimeSettings(tempDir);
		expect(reloadedRuntimeSettings.getResponseSettings()).toEqual({
			mention: false,
			dm: true,
			channel: true,
		});
		expect(reloadedRuntimeSettings.getObsidianPath()).toBe("/vault/main");
	});

	it("applies env settings without overriding existing process env", () => {
		runtimeSettings.setEnv({ FROM_SETTINGS: "from-file", EXISTING_ENV: "from-file", MOM_LOG_LEVEL: "warn" });
		process.env.EXISTING_ENV = "from-process";

		runtimeSettings.applyEnvToProcessEnv();

		expect(process.env.FROM_SETTINGS).toBe("from-file");
		expect(process.env.EXISTING_ENV).toBe("from-process");
		expect(runtimeSettings.getLogLevel()).toBe("warn");
	});

	it("does not silently drop project-scope shared writes", async () => {
		settingsManager.setProjectPackages([{ source: "npm:test-pkg" }]);

		await settingsManager.flush();

		const reloadedManager = createMomSettingsManager(tempDir);
		expect(reloadedManager.getPackages()).toEqual([{ source: "npm:test-pkg" }]);
		expect(readSettingsFile().packages).toEqual([{ source: "npm:test-pkg" }]);
	});
});
