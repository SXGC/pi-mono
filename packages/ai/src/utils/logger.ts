import { createLogger, type Logger, type LogLevel } from "@mariozechner/pi-observer";

const DEFAULT_LEVEL: LogLevel = "info";
const LOG_LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal"]);

function isLogLevel(value: string | undefined): value is LogLevel {
	if (!value) return false;
	return LOG_LEVELS.has(value);
}

function getAiLogLevel(): LogLevel {
	const processObject =
		typeof globalThis !== "undefined" && "process" in globalThis
			? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
			: undefined;

	const level = processObject?.env?.AI_LOG_LEVEL;
	if (isLogLevel(level)) {
		return level;
	}

	return DEFAULT_LEVEL;
}

export const log: Logger = createLogger({
	name: "pi-ai",
	level: getAiLogLevel(),
});
