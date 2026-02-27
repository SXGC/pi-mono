/**
 * AI package logger.
 * Uses Pino for structured logging via the observer module.
 */

import { createLogger, type Logger } from "@mariozechner/pi-observer";

/**
 * Logger instance for the AI package.
 * Provides structured logging with trace/debug/info/warn/error/fatal levels.
 */
export const log: Logger = createLogger({
	name: "pi-ai",
	level: "info",
});
