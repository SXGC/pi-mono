/**
 * Pino logger wrapper with JSON/pretty mode switching.
 */

import pino, { type Logger, type LoggerOptions } from "pino";
import type { LoggerConfig, LogLevel } from "./types.js";

let defaultLogger: Logger | undefined;

/**
 * Default log level.
 */
const DEFAULT_LEVEL: LogLevel = "info";

/**
 * Create a named logger instance.
 *
 * @param config - Logger configuration
 * @returns Pino logger instance
 *
 * @example
 * ```typescript
 * import { createLogger } from "@mariozechner/pi-observer";
 *
 * const log = createLogger({ name: "coding-agent", level: "debug" });
 * log.info({ sessionId: "abc", model: "claude-4" }, "session started");
 * log.warn({ tokenCount: 190000, limit: 200000 }, "approaching context limit");
 * ```
 */
export function createLogger(config?: LoggerConfig): Logger {
	const level = config?.level ?? DEFAULT_LEVEL;
	const name = config?.name;
	const pretty = config?.pretty ?? true;
	const destination = config?.destination;

	const options: LoggerOptions = {
		level,
		...(name && { name }),
	};

	// Use pino-pretty for development-friendly output
	if (pretty && !destination) {
		const isDev = process.env.NODE_ENV !== "production";
		const defaultSingleLine = isDev ? true : undefined;
		options.transport = {
			target: "pino-pretty",
			options: {
				colorize: true,
				translateTime: `SYS:yyyy-mm-dd HH:MM:ss.l`,
				ignore: "pid,hostname",
				singleLine: defaultSingleLine,
				messageFormat: "{if module}[{module}] {end}{msg}",
				...config?.prettyOptions,
			},
		};
	}

	// Use custom destination or stdout
	if (destination) {
		return pino(options, destination);
	}

	return pino(options);
}

/**
 * Get the global default logger (singleton).
 * Creates a new logger if one doesn't exist.
 *
 * @param config - Optional configuration to override default settings
 * @returns Pino logger instance
 */
export function getLogger(config?: LoggerConfig): Logger {
	if (!defaultLogger) {
		defaultLogger = createLogger(config);
	}
	return defaultLogger;
}

/**
 * Set the global default logger.
 * Useful for testing or when you want to replace the default logger.
 *
 * @param logger - Logger instance to use as default
 */
export function setDefaultLogger(logger: Logger): void {
	defaultLogger = logger;
}

/**
 * Reset the global default logger.
 * Useful for testing to ensure a clean state.
 */
export function resetDefaultLogger(): void {
	defaultLogger = undefined;
}

// Re-export pino types
export type { Logger } from "pino";
