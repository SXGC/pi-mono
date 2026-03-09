import type { UserMessage } from "@mariozechner/pi-ai";
import { type SessionManager, type SessionMessageEntry, SettingsManager } from "@mariozechner/pi-coding-agent";
import type { LangfuseConfig } from "@mariozechner/pi-observer";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import lockfile from "proper-lockfile";

interface LogMessage {
	date?: string;
	ts?: string;
	user?: string;
	userName?: string;
	text?: string;
	isBot?: boolean;
}

export function syncLogToSessionManager(
	sessionManager: SessionManager,
	channelDir: string,
	excludeSlackTs?: string,
): number {
	const logFile = join(channelDir, "log.jsonl");

	if (!existsSync(logFile)) return 0;

	const existingMessages = new Set<string>();
	for (const entry of sessionManager.getEntries()) {
		if (entry.type === "message") {
			const msgEntry = entry as SessionMessageEntry;
			const msg = msgEntry.message as { role: string; content?: unknown };
			if (msg.role === "user" && msg.content !== undefined) {
				const content = msg.content;
				if (typeof content === "string") {
					let normalized = content.replace(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}\] /, "");
					const attachmentsIdx = normalized.indexOf("\n\n<slack_attachments>\n");
					if (attachmentsIdx !== -1) {
						normalized = normalized.substring(0, attachmentsIdx);
					}
					existingMessages.add(normalized);
				} else if (Array.isArray(content)) {
					for (const part of content) {
						if (
							typeof part === "object" &&
							part !== null &&
							"type" in part &&
							part.type === "text" &&
							"text" in part
						) {
							let normalized = (part as { type: "text"; text: string }).text;
							normalized = normalized.replace(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}\] /, "");
							const attachmentsIdx = normalized.indexOf("\n\n<slack_attachments>\n");
							if (attachmentsIdx !== -1) {
								normalized = normalized.substring(0, attachmentsIdx);
							}
							existingMessages.add(normalized);
						}
					}
				}
			}
		}
	}

	const logContent = readFileSync(logFile, "utf-8");
	const logLines = logContent.trim().split("\n").filter(Boolean);

	const newMessages: Array<{ timestamp: number; message: UserMessage }> = [];

	for (const line of logLines) {
		try {
			const logMsg: LogMessage = JSON.parse(line);

			const slackTs = logMsg.ts;
			const date = logMsg.date;
			if (!slackTs || !date) continue;

			if (excludeSlackTs && slackTs === excludeSlackTs) continue;

			if (logMsg.isBot) continue;

			const messageText = `[${logMsg.userName || logMsg.user || "unknown"}]: ${logMsg.text || ""}`;

			if (existingMessages.has(messageText)) continue;

			const msgTime = new Date(date).getTime() || Date.now();
			const userMessage: UserMessage = {
				role: "user",
				content: [{ type: "text", text: messageText }],
				timestamp: msgTime,
			};

			newMessages.push({ timestamp: msgTime, message: userMessage });
			existingMessages.add(messageText);
		} catch {}
	}

	if (newMessages.length === 0) return 0;

	newMessages.sort((a, b) => a.timestamp - b.timestamp);

	for (const { message } of newMessages) {
		sessionManager.appendMessage(message);
	}

	return newMessages.length;
}

type MomSettingsStorage = Parameters<typeof SettingsManager.fromStorage>[0];
type WorkspaceSettingsScope = "global" | "project";

export type MomLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type MomLangfuseSettings = LangfuseConfig;

export interface MomResponseSettings {
	mention: boolean;
	dm: boolean;
	channel: boolean;
}

interface MomWorkspaceSettings {
	response?: Partial<MomResponseSettings>;
	env?: Record<string, string>;
	obsidianPath?: string;
	langfuse?: MomLangfuseSettings;
	[key: string]: unknown;
}

export interface MomResponseSettingsProvider {
	getResponseSettings(): MomResponseSettings;
}

const MOM_LOG_LEVELS = new Set<MomLogLevel>(["trace", "debug", "info", "warn", "error", "fatal"]);

const DEFAULT_RESPONSE: MomResponseSettings = {
	mention: true,
	dm: true,
	channel: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMomLogLevel(value: string | undefined): value is MomLogLevel {
	if (!value) return false;
	return MOM_LOG_LEVELS.has(value as MomLogLevel);
}

function parseWorkspaceSettings(current: string | undefined, throwOnInvalid = false): MomWorkspaceSettings {
	if (!current) {
		return {};
	}

	try {
		const parsed = JSON.parse(current);
		if (!isRecord(parsed)) {
			if (throwOnInvalid) {
				throw new Error("Workspace settings must be a JSON object");
			}
			return {};
		}
		return parsed;
	} catch (error) {
		if (throwOnInvalid) {
			throw error;
		}
		return {};
	}
}

function normalizeResponseSettings(value: unknown): Partial<MomResponseSettings> {
	if (!isRecord(value)) {
		return {};
	}

	const response: Partial<MomResponseSettings> = {};
	if (typeof value.mention === "boolean") {
		response.mention = value.mention;
	}
	if (typeof value.dm === "boolean") {
		response.dm = value.dm;
	}
	if (typeof value.channel === "boolean") {
		response.channel = value.channel;
	}
	return response;
}

function normalizeStringMap(value: unknown): Record<string, string> {
	if (!isRecord(value)) {
		return {};
	}

	const entries = Object.entries(value).filter(([, entryValue]) => typeof entryValue === "string");
	return Object.fromEntries(entries) as Record<string, string>;
}

export class WorkspaceSettingsStorage implements MomSettingsStorage {
	private settingsPath: string;

	constructor(workspaceDir: string) {
		this.settingsPath = join(workspaceDir, "settings.json");
	}

	private acquireLockSyncWithRetry(path: string): () => void {
		const maxAttempts = 10;
		const delayMs = 20;
		let lastError: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				return lockfile.lockSync(path, { realpath: false });
			} catch (error) {
				const code =
					typeof error === "object" && error !== null && "code" in error
						? String((error as { code?: unknown }).code)
						: undefined;
				if (code !== "ELOCKED" || attempt === maxAttempts) {
					throw error;
				}
				lastError = error;
				const start = Date.now();
				while (Date.now() - start < delayMs) {}
			}
		}

		throw (lastError as Error) ?? new Error("Failed to acquire workspace settings lock");
	}

	private getSettingsPath(_scope: WorkspaceSettingsScope): string {
		return this.settingsPath;
	}

	withLock(scope: WorkspaceSettingsScope, fn: (current: string | undefined) => string | undefined): void {
		const path = this.getSettingsPath(scope);
		const dir = dirname(path);

		let release: (() => void) | undefined;
		try {
			const fileExists = existsSync(path);
			if (fileExists) {
				release = this.acquireLockSyncWithRetry(path);
			}

			const current = fileExists ? readFileSync(path, "utf-8") : undefined;
			const next = fn(current);
			if (next === undefined) {
				return;
			}

			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
			if (!release) {
				release = this.acquireLockSyncWithRetry(path);
			}

			writeFileSync(path, next, "utf-8");
		} finally {
			if (release) {
				release();
			}
		}
	}
}

export class MomRuntimeSettings implements MomResponseSettingsProvider {
	private storage: MomSettingsStorage;

	constructor(storage: MomSettingsStorage) {
		this.storage = storage;
	}

	private readSettings(): MomWorkspaceSettings {
		let settings: MomWorkspaceSettings = {};
		this.storage.withLock("global", (current) => {
			settings = parseWorkspaceSettings(current);
			return undefined;
		});
		return settings;
	}

	private updateSettings(updater: (settings: MomWorkspaceSettings) => void): void {
		this.storage.withLock("global", (current) => {
			const settings = parseWorkspaceSettings(current, true);
			updater(settings);
			return JSON.stringify(settings, null, 2);
		});
	}

	getResponseSettings(): MomResponseSettings {
		const settings = this.readSettings();
		return {
			...DEFAULT_RESPONSE,
			...normalizeResponseSettings(settings.response),
		};
	}

	setResponseSettings(response: Partial<MomResponseSettings>): void {
		this.updateSettings((settings) => {
			settings.response = {
				...normalizeResponseSettings(settings.response),
				...response,
			};
		});
	}

	getEnv(): Record<string, string> {
		return normalizeStringMap(this.readSettings().env);
	}

	setEnv(env: Record<string, string> | undefined): void {
		this.updateSettings((settings) => {
			if (env && Object.keys(env).length > 0) {
				settings.env = { ...env };
				return;
			}

			delete settings.env;
		});
	}

	applyEnvToProcessEnv(): void {
		for (const [key, value] of Object.entries(this.getEnv())) {
			if (process.env[key] === undefined) {
				process.env[key] = value;
			}
		}
	}

	getLogLevel(): MomLogLevel {
		const configured = process.env.MOM_LOG_LEVEL ?? this.getEnv().MOM_LOG_LEVEL;
		return isMomLogLevel(configured) ? configured : "info";
	}

	setLogLevel(level: MomLogLevel | undefined): void {
		this.updateSettings((settings) => {
			const env = normalizeStringMap(settings.env);
			if (level) {
				env.MOM_LOG_LEVEL = level;
			} else {
				delete env.MOM_LOG_LEVEL;
			}

			if (Object.keys(env).length > 0) {
				settings.env = env;
				return;
			}

			delete settings.env;
		});
	}

	getObsidianPath(): string | undefined {
		const value = this.readSettings().obsidianPath;
		return typeof value === "string" ? value : undefined;
	}

	setObsidianPath(obsidianPath: string | undefined): void {
		this.updateSettings((settings) => {
			if (obsidianPath) {
				settings.obsidianPath = obsidianPath;
				return;
			}

			delete settings.obsidianPath;
		});
	}
}

export function createMomSettingsManager(workspaceDir: string): SettingsManager {
	return SettingsManager.fromStorage(new WorkspaceSettingsStorage(workspaceDir));
}

export function createMomRuntimeSettings(workspaceDir: string): MomRuntimeSettings {
	return new MomRuntimeSettings(new WorkspaceSettingsStorage(workspaceDir));
}
