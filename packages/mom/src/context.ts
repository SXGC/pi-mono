import type { LangfuseConfig } from "@mariozechner/pi-observer/tracing";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { log } from "./log.js";

// ============================================================================
// MomSettingsManager - Simple settings for mom
// ============================================================================

export interface MomCompactionSettings {
	enabled: boolean;
	reserveTokens: number;
	keepRecentTokens: number;
}

export interface MomRetrySettings {
	enabled: boolean;
	maxRetries: number;
	baseDelayMs: number;
}
export interface MomImageSettings {
	autoResize: boolean;
}
export interface MomBranchSummarySettings {
	reserveTokens: number;
}
export type MomLangfuseSettings = LangfuseConfig;
export interface MomFallbackModel {
	provider: string;
	modelId: string;
}
export interface MomFallbackSettings {
	enabled?: boolean;
	models?: MomFallbackModel[];
	onFallbackExhausted?: "error" | "ask";
}

export interface MomResponseSettings {
	/** Respond to @mentions in channels */
	mention: boolean;
	/** Respond to direct messages */
	dm: boolean;
	/** Respond to regular channel messages (not @mentions) */
	channel: boolean;
}

export interface MomSettings {
	defaultProvider?: string;
	defaultModel?: string;
	defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
	compaction?: Partial<MomCompactionSettings>;
	retry?: Partial<MomRetrySettings>;
	images?: Partial<MomImageSettings>;
	branchSummary?: Partial<MomBranchSummarySettings>;
	langfuse?: MomLangfuseSettings;
	fallback?: MomFallbackSettings;
	response?: Partial<MomResponseSettings>;
	shellCommandPrefix?: string;
	theme?: string;
	env?: Record<string, string>;
	obsidianPath?: string;
}

const MOM_LOG_LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal"]);

function isMomLogLevel(value: string | undefined): value is "trace" | "debug" | "info" | "warn" | "error" | "fatal" {
	if (!value) return false;
	return MOM_LOG_LEVELS.has(value);
}
const DEFAULT_COMPACTION: MomCompactionSettings = {
	enabled: true,
	reserveTokens: 16384,
	keepRecentTokens: 20000,
};
const DEFAULT_RETRY: MomRetrySettings = {
	enabled: true,
	maxRetries: 3,
	baseDelayMs: 2000,
};
const DEFAULT_IMAGES: MomImageSettings = {
	autoResize: true,
};
const DEFAULT_BRANCH_SUMMARY: MomBranchSummarySettings = {
	reserveTokens: 16384,
};

const DEFAULT_RESPONSE: MomResponseSettings = {
	mention: true,
	dm: true,
	channel: false,
};

/**
 * Settings manager for mom.
 * Stores settings in the workspace root directory.
 */
export class MomSettingsManager {
	private settingsPath: string;
	private settings: MomSettings;

	constructor(workspaceDir: string) {
		this.settingsPath = join(workspaceDir, "settings.json");
		this.settings = this.load();
	}

	private load(): MomSettings {
		if (!existsSync(this.settingsPath)) {
			return {};
		}

		try {
			const content = readFileSync(this.settingsPath, "utf-8");
			return JSON.parse(content);
		} catch {
			return {};
		}
	}

	private save(): void {
		try {
			const dir = dirname(this.settingsPath);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
			writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), "utf-8");
		} catch (error) {
			log.warn({ error: String(error) }, "Could not save settings file");
		}
	}

	getCompactionSettings(): MomCompactionSettings {
		return {
			...DEFAULT_COMPACTION,
			...this.settings.compaction,
		};
	}

	getCompactionEnabled(): boolean {
		return this.settings.compaction?.enabled ?? DEFAULT_COMPACTION.enabled;
	}

	setCompactionEnabled(enabled: boolean): void {
		this.settings.compaction = { ...this.settings.compaction, enabled };
		this.save();
	}

	getRetrySettings(): MomRetrySettings {
		return {
			...DEFAULT_RETRY,
			...this.settings.retry,
		};
	}

	getRetryEnabled(): boolean {
		return this.settings.retry?.enabled ?? DEFAULT_RETRY.enabled;
	}

	setRetryEnabled(enabled: boolean): void {
		this.settings.retry = { ...this.settings.retry, enabled };
		this.save();
	}

	getResponseSettings(): MomResponseSettings {
		return {
			...DEFAULT_RESPONSE,
			...this.settings.response,
		};
	}
	getDefaultModel(): string | undefined {
		return this.settings.defaultModel;
	}

	getDefaultProvider(): string | undefined {
		return this.settings.defaultProvider;
	}

	setDefaultModelAndProvider(provider: string, modelId: string): void {
		this.settings.defaultProvider = provider;
		this.settings.defaultModel = modelId;
		this.save();
	}

	getDefaultThinkingLevel(): "off" | "minimal" | "low" | "medium" | "high" {
		return this.settings.defaultThinkingLevel || "off";
	}

	setDefaultThinkingLevel(level: "off" | "minimal" | "low" | "medium" | "high"): void {
		this.settings.defaultThinkingLevel = level;
		this.save();
	}

	getImageAutoResize(): boolean {
		return this.settings.images?.autoResize ?? DEFAULT_IMAGES.autoResize;
	}

	setImageAutoResize(enabled: boolean): void {
		this.settings.images = { ...this.settings.images, autoResize: enabled };
		this.save();
	}

	getShellCommandPrefix(): string | undefined {
		return this.settings.shellCommandPrefix;
	}

	setShellCommandPrefix(prefix: string | undefined): void {
		this.settings.shellCommandPrefix = prefix;
		this.save();
	}

	getBranchSummarySettings(): MomBranchSummarySettings {
		return {
			...DEFAULT_BRANCH_SUMMARY,
			...this.settings.branchSummary,
		};
	}

	getTheme(): string | undefined {
		return this.settings.theme;
	}

	getObsidianPath(): string | undefined {
		return this.settings.obsidianPath;
	}

	setObsidianPath(path: string | undefined): void {
		this.settings.obsidianPath = path;
		this.save();
	}
	getLangfuseSettings(): MomLangfuseSettings {
		return this.settings.langfuse ?? { enabled: false };
	}

	getFallbackEnabled(): boolean {
		return this.settings.fallback?.enabled ?? false;
	}

	setFallbackEnabled(enabled: boolean): void {
		if (!this.settings.fallback) {
			this.settings.fallback = {};
		}
		this.settings.fallback.enabled = enabled;
		this.save();
	}

	getFallbackModels(): MomFallbackModel[] | undefined {
		return this.settings.fallback?.models;
	}

	setFallbackModels(models: MomFallbackModel[] | undefined): void {
		if (!this.settings.fallback) {
			this.settings.fallback = {};
		}
		this.settings.fallback.models = models;
		this.save();
	}

	getFallbackOnExhausted(): "error" | "ask" {
		return this.settings.fallback?.onFallbackExhausted ?? "error";
	}

	setFallbackOnExhausted(action: "error" | "ask"): void {
		if (!this.settings.fallback) {
			this.settings.fallback = {};
		}
		this.settings.fallback.onFallbackExhausted = action;
		this.save();
	}

	getFallbackSettings(): {
		enabled: boolean;
		models: MomFallbackModel[] | undefined;
		onFallbackExhausted: "error" | "ask";
	} {
		return {
			enabled: this.getFallbackEnabled(),
			models: this.getFallbackModels(),
			onFallbackExhausted: this.getFallbackOnExhausted(),
		};
	}

	reload(): void {
		this.settings = this.load();
	}

	getEnv(): Record<string, string> {
		const env: Record<string, string> = {};

		const rawEnv = this.settings.env;
		if (rawEnv && typeof rawEnv === "object") {
			for (const [key, value] of Object.entries(rawEnv as Record<string, unknown>)) {
				if (!key) continue;
				if (typeof value !== "string") {
					log.warn({ key, valueType: typeof value }, "Ignoring non-string settings.env value");
					continue;
				}
				env[key] = value;
			}
		}

		return env;
	}

	applyEnvToProcessEnv(): void {
		const env = this.getEnv();
		for (const [key, value] of Object.entries(env)) {
			if (process.env[key] !== undefined) continue;
			process.env[key] = value;
		}
	}

	// Compatibility methods for AgentSession
	getSteeringMode(): "all" | "one-at-a-time" {
		return "one-at-a-time"; // Mom processes one message at a time
	}

	setSteeringMode(_mode: "all" | "one-at-a-time"): void {
		// No-op for mom
	}

	getFollowUpMode(): "all" | "one-at-a-time" {
		return "one-at-a-time"; // Mom processes one message at a time
	}

	setFollowUpMode(_mode: "all" | "one-at-a-time"): void {
		// No-op for mom
	}

	getHookPaths(): string[] {
		return []; // Mom doesn't use hooks
	}

	getHookTimeout(): number {
		return 30000;
	}

	getLogLevel(): "trace" | "debug" | "info" | "warn" | "error" | "fatal" {
		const envLogLevel = process.env.MOM_LOG_LEVEL;
		if (isMomLogLevel(envLogLevel)) {
			return envLogLevel;
		}
		if (envLogLevel) {
			log.warn({ MOM_LOG_LEVEL: envLogLevel }, "Invalid MOM_LOG_LEVEL, falling back to default");
		}

		return "info";
	}

	setLogLevel(level: "trace" | "debug" | "info" | "warn" | "error" | "fatal"): void {
		this.settings.env = {
			...(this.settings.env ?? {}),
			MOM_LOG_LEVEL: level,
		};
		this.save();
	}
}
