/**
 * Centralized logging for mom package using observer module.
 */

import { createLogger as createPinoLogger, type Logger, type LogLevel } from "@mariozechner/pi-observer";

export interface LogContext {
	channelId: string;
	userName?: string;
	channelName?: string;
}

export type LogModule = "system" | "observer" | "agent" | "slack" | "store" | "events";

export interface ModuleLogger {
	info(message: string, fields?: Record<string, unknown>): void;
	warning(message: string, details?: string, fields?: Record<string, unknown>): void;
	agentError(ctx: LogContext | "system", error: string): void;
	backfillStart(channelCount: number): void;
	backfillChannel(channelName: string, messageCount: number): void;
	backfillComplete(totalMessages: number, durationMs: number): void;
}

// Default log level - can be changed via setLogLevel()
const DEFAULT_LOG_LEVEL: LogLevel = "info";

// Main logger instance
const log: Logger = createPinoLogger({
	name: "pi-mom",
	level: DEFAULT_LOG_LEVEL,
});

/**
 * Set the log level at runtime.
 * @param level - The log level to set
 */
export function setLogLevel(level: LogLevel): void {
	log.level = level;
}

/**
 * Format LogContext as structured fields for logging.
 */
function contextFields(ctx: LogContext): Record<string, unknown> {
	return {
		channelId: ctx.channelId,
		channelName: ctx.channelName,
		userName: ctx.userName,
	};
}

/**
 * Truncate text to max length with indicator.
 */
function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.substring(0, maxLen)}\n(truncated at ${maxLen} chars)`;
}

/**
 * Format tool arguments for logging.
 */
function formatToolArgs(args: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(args)) {
		if (key === "label") continue;
		if (key === "offset" || key === "limit") continue;

		if (key === "path" && typeof value === "string") {
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			if (offset !== undefined && limit !== undefined) {
				result.path = `${value}:${offset}-${offset + limit}`;
			} else {
				result.path = value;
			}
			continue;
		}

		result[key] = value;
	}

	return result;
}

// User messages
export function logUserMessage(ctx: LogContext, text: string): void {
	log.info({ ...contextFields(ctx), text }, "User message");
}

// Tool execution
export function logToolStart(ctx: LogContext, toolName: string, label: string, args: Record<string, unknown>): void {
	log.debug(
		{
			...contextFields(ctx),
			toolName,
			toolLabel: label,
			args: formatToolArgs(args),
		},
		`Tool started: ${toolName}`,
	);
}

export function logToolSuccess(ctx: LogContext, toolName: string, durationMs: number, result: string): void {
	const truncated = truncate(result, 1000);
	log.info(
		{
			...contextFields(ctx),
			toolName,
			durationMs,
			result: truncated,
		},
		`Tool completed: ${toolName}`,
	);
}

export function logToolError(ctx: LogContext, toolName: string, durationMs: number, error: string): void {
	const truncated = truncate(error, 1000);
	log.error(
		{
			...contextFields(ctx),
			toolName,
			durationMs,
			error: truncated,
		},
		`Tool failed: ${toolName}`,
	);
}

// Response streaming
export function logResponseStart(ctx: LogContext): void {
	log.debug({ ...contextFields(ctx) }, "Streaming response");
}

export function logThinking(ctx: LogContext, thinking: string): void {
	const truncated = truncate(thinking, 1000);
	log.debug({ ...contextFields(ctx), thinking: truncated }, "Thinking");
}

export function logResponse(ctx: LogContext, text: string): void {
	const truncated = truncate(text, 1000);
	log.debug({ ...contextFields(ctx), response: truncated }, "Response");
}

// Attachments
export function logDownloadStart(ctx: LogContext, filename: string, localPath: string): void {
	log.info({ ...contextFields(ctx), filename, localPath }, "Downloading attachment");
}

export function logDownloadSuccess(ctx: LogContext, sizeKB: number): void {
	log.info({ ...contextFields(ctx), sizeKB }, "Download completed");
}

export function logDownloadError(ctx: LogContext, filename: string, error: string): void {
	log.error({ ...contextFields(ctx), filename, error }, "Download failed");
}

// Control
export function logStopRequest(ctx: LogContext): void {
	log.info({ ...contextFields(ctx) }, "Stop requested");
}

// Module logger factory
export function createModuleLogger(module: LogModule): ModuleLogger {
	return {
		info(message: string, fields?: Record<string, unknown>): void {
			log.info({ module, ...fields }, message);
		},
		warning(message: string, details?: string, fields?: Record<string, unknown>): void {
			log.warn({ module, details, ...fields }, message);
		},
		agentError(ctx: LogContext | "system", error: string): void {
			if (ctx === "system") {
				log.error({ module, error }, "Agent error");
			} else {
				log.error({ module, ...contextFields(ctx), error }, "Agent error");
			}
		},
		backfillStart(channelCount: number): void {
			log.info({ module, channelCount }, "Backfill started");
		},
		backfillChannel(channelName: string, messageCount: number): void {
			log.debug({ module, channelName, messageCount }, "Backfill channel");
		},
		backfillComplete(totalMessages: number, durationMs: number): void {
			const duration = (durationMs / 1000).toFixed(1);
			log.info({ module, totalMessages, durationMs, duration }, "Backfill completed");
		},
	};
}

// Alias for backward compatibility
export const createLogger = createModuleLogger;

// Default system logger
const systemLogger = createModuleLogger("system");

export function logInfo(message: string, fields?: Record<string, unknown>): void {
	systemLogger.info(message, fields);
}

export function logWarning(message: string, details?: string, fields?: Record<string, unknown>): void {
	systemLogger.warning(message, details, fields);
}

export function logAgentError(ctx: LogContext | "system", error: string): void {
	systemLogger.agentError(ctx, error);
}

// Usage summary
export function logUsageSummary(
	ctx: LogContext,
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	},
	contextTokens?: number,
	contextWindow?: number,
	model?: { provider: string; id: string },
): string {
	const formatTokens = (count: number): string => {
		if (count < 1000) return count.toString();
		if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
		if (count < 1000000) return `${Math.round(count / 1000)}k`;
		return `${(count / 1000000).toFixed(1)}M`;
	};

	const lines: string[] = [];
	lines.push("*Usage Summary*");
	if (model) {
		lines.push(`Model: ${model.provider}/${model.id}`);
	}
	lines.push(`Tokens: ${usage.input.toLocaleString()} in, ${usage.output.toLocaleString()} out`);
	if (usage.cacheRead > 0 || usage.cacheWrite > 0) {
		lines.push(`Cache: ${usage.cacheRead.toLocaleString()} read, ${usage.cacheWrite.toLocaleString()} write`);
	}
	if (contextTokens && contextWindow) {
		const contextPercent = ((contextTokens / contextWindow) * 100).toFixed(1);
		lines.push(`Context: ${formatTokens(contextTokens)} / ${formatTokens(contextWindow)} (${contextPercent}%)`);
	}
	lines.push(
		`Cost: $${usage.cost.input.toFixed(4)} in, $${usage.cost.output.toFixed(4)} out` +
			(usage.cacheRead > 0 || usage.cacheWrite > 0
				? `, $${usage.cost.cacheRead.toFixed(4)} cache read, $${usage.cost.cacheWrite.toFixed(4)} cache write`
				: ""),
	);
	lines.push(`*Total: $${usage.cost.total.toFixed(4)}*`);

	const summary = lines.join("\n");

	// Log structured usage data
	log.info(
		{
			...contextFields(ctx),
			inputTokens: usage.input,
			outputTokens: usage.output,
			cacheRead: usage.cacheRead,
			cacheWrite: usage.cacheWrite,
			costTotal: usage.cost.total,
			contextTokens,
			contextWindow,
			model,
		},
		"Usage summary",
	);

	return summary;
}

// Startup
export function logStartup(workingDir: string, sandbox: string): void {
	log.info({ workingDir, sandbox }, "Starting mom bot");
}

export function logConnected(): void {
	log.info("Mom bot connected and listening");
}

export function logDisconnected(): void {
	log.info("Mom bot disconnected");
}

// Backfill
export function logBackfillStart(channelCount: number): void {
	systemLogger.backfillStart(channelCount);
}

export function logBackfillChannel(channelName: string, messageCount: number): void {
	systemLogger.backfillChannel(channelName, messageCount);
}

export function logBackfillComplete(totalMessages: number, durationMs: number): void {
	systemLogger.backfillComplete(totalMessages, durationMs);
}

// Export the logger for direct use in other modules
export { log };
