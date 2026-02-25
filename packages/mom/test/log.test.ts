import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, logAgentError, logBackfillComplete, logBackfillStart, logInfo, logWarning } from "../src/log.js";

function stripAnsi(text: string): string {
	return text.replace(/\u001b\[[0-9;]*m/g, "");
}

describe("mom log module", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		logSpy.mockRestore();
	});

	it("createLogger() emits module prefix for observer logs", () => {
		const observerLog = createLogger("observer");
		observerLog.info("Langfuse telemetry disabled");

		expect(logSpy).toHaveBeenCalledTimes(1);
		const line = stripAnsi(String(logSpy.mock.calls[0][0]));
		expect(line).toMatch(/^\[\d{2}:\d{2}:\d{2}\] \[observer\] Langfuse telemetry disabled$/);
	});

	it("createLogger() adds module prefix for system-context agent errors", () => {
		const observerLog = createLogger("observer");
		observerLog.agentError("system", "boom");

		expect(logSpy).toHaveBeenCalledTimes(2);
		const header = stripAnsi(String(logSpy.mock.calls[0][0]));
		const details = stripAnsi(String(logSpy.mock.calls[1][0]));

		expect(header).toMatch(/^\[\d{2}:\d{2}:\d{2}\] \[observer\] ✗ Agent error$/);
		expect(details).toContain("boom");
	});

	it("legacy wrappers remain on [system] prefix for backward compatibility", () => {
		logInfo("hello");
		logWarning("warn", "details");
		logAgentError("system", "err");
		logBackfillStart(2);
		logBackfillComplete(5, 1200);

		const lines = logSpy.mock.calls.map((call) => stripAnsi(String(call[0])));
		expect(lines.some((line) => line.includes("[system] hello"))).toBe(true);
		expect(lines.some((line) => line.includes("[system] ⚠ warn"))).toBe(true);
		expect(lines.some((line) => line.includes("[system] ✗ Agent error"))).toBe(true);
		expect(lines.some((line) => line.includes("[system] Backfilling 2 channels..."))).toBe(true);
		expect(lines.some((line) => line.includes("[system] Backfill complete: 5 messages in 1.2s"))).toBe(true);
	});
});
