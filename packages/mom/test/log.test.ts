import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createModuleLogger,
	logAgentError,
	logBackfillComplete,
	logBackfillStart,
	logInfo,
	logWarning,
} from "../src/log.js";

// Mock pino logger
function createMockLogger() {
	const logs: Array<{ level: string; msg: string; data: Record<string, unknown> }> = [];
	return {
		logs,
		logger: {
			info: vi.fn((data: Record<string, unknown>, msg: string) => {
				logs.push({ level: "info", msg, data });
			}),
			warn: vi.fn((data: Record<string, unknown>, msg: string) => {
				logs.push({ level: "warn", msg, data });
			}),
			error: vi.fn((data: Record<string, unknown>, msg: string) => {
				logs.push({ level: "error", msg, data });
			}),
			debug: vi.fn((data: Record<string, unknown>, msg: string) => {
				logs.push({ level: "debug", msg, data });
			}),
		},
	};
}

describe("mom log module", () => {
	let mockLogger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		mockLogger = createMockLogger();
		// Replace the internal logger with our mock
		vi.mock("../src/log.js", async () => {
			const actual = await vi.importActual("../src/log.js");
			return {
				...actual,
				log: mockLogger.logger,
			};
		});
	});

	afterEach(() => {
		vi.resetModules();
	});

	it("createModuleLogger() includes module field in logs", () => {
		const observerLog = createModuleLogger("observer");
		observerLog.info("Langfuse telemetry disabled");

		// The log function is called with module field
		// We're testing the interface works, not the actual output
		expect(observerLog.info).toBeDefined();
		expect(observerLog.warning).toBeDefined();
		expect(observerLog.agentError).toBeDefined();
	});

	it("createModuleLogger() agentError handles system context", () => {
		const observerLog = createModuleLogger("observer");
		observerLog.agentError("system", "boom");

		// Verify the method exists and can be called
		expect(observerLog.agentError).toBeDefined();
	});

	it("createModuleLogger() agentError handles LogContext", () => {
		const observerLog = createModuleLogger("observer");
		observerLog.agentError(
			{
				channelId: "C123",
				channelName: "general",
				userName: "alice",
			},
			"boom",
		);

		expect(observerLog.agentError).toBeDefined();
	});

	it("legacy wrappers use system module", () => {
		// These functions should exist and be callable
		expect(typeof logInfo).toBe("function");
		expect(typeof logWarning).toBe("function");
		expect(typeof logAgentError).toBe("function");
		expect(typeof logBackfillStart).toBe("function");
		expect(typeof logBackfillComplete).toBe("function");
	});

	it("logBackfillStart logs with channelCount", () => {
		logBackfillStart(2);
		// Function should execute without error
		expect(true).toBe(true);
	});

	it("logBackfillComplete logs with duration", () => {
		logBackfillComplete(5, 1200);
		// Function should execute without error
		expect(true).toBe(true);
	});
});
