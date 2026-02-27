import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger, getLogger, resetDefaultLogger, setDefaultLogger } from "../src/logger/index.js";

describe("Logger", () => {
	beforeEach(() => {
		resetDefaultLogger();
	});

	afterEach(() => {
		resetDefaultLogger();
	});

	describe("createLogger", () => {
		it("should create a logger with default options", () => {
			const log = createLogger();
			expect(log).toBeDefined();
			expect(typeof log.info).toBe("function");
			expect(typeof log.error).toBe("function");
			expect(typeof log.warn).toBe("function");
			expect(typeof log.debug).toBe("function");
			expect(typeof log.trace).toBe("function");
		});

		it("should create a logger with custom name", () => {
			const log = createLogger({ name: "test-logger" });
			expect(log).toBeDefined();
		});

		it("should create a logger with custom level", () => {
			const log = createLogger({ level: "debug" });
			expect(log).toBeDefined();
		});

		it("should create a logger with JSON mode", () => {
			const log = createLogger({ pretty: false });
			expect(log).toBeDefined();
		});

		it("should create different logger instances", () => {
			const log1 = createLogger({ name: "logger1" });
			const log2 = createLogger({ name: "logger2" });
			expect(log1).not.toBe(log2);
		});
	});

	describe("getLogger", () => {
		it("should return a default logger when called without config", () => {
			const log1 = getLogger();
			const log2 = getLogger();
			expect(log1).toBe(log2);
		});

		it("should use config only on first call", () => {
			const log1 = getLogger({ name: "first" });
			const log2 = getLogger({ name: "second" });
			// Both should be the same logger (first one wins)
			expect(log1).toBe(log2);
		});
	});

	describe("setDefaultLogger", () => {
		it("should set a custom default logger", () => {
			const customLog = createLogger({ name: "custom-default" });
			setDefaultLogger(customLog);
			const log = getLogger();
			expect(log).toBe(customLog);
		});
	});

	describe("resetDefaultLogger", () => {
		it("should reset the default logger", () => {
			const customLog = createLogger({ name: "custom-default" });
			setDefaultLogger(customLog);
			resetDefaultLogger();
			const log = getLogger();
			expect(log).not.toBe(customLog);
		});
	});

	describe("logging methods", () => {
		it("should have all logging methods", () => {
			const log = createLogger();
			expect(typeof log.info).toBe("function");
			expect(typeof log.error).toBe("function");
			expect(typeof log.warn).toBe("function");
			expect(typeof log.debug).toBe("function");
			expect(typeof log.trace).toBe("function");
			expect(typeof log.fatal).toBe("function");
		});

		it("should not throw when logging", () => {
			const log = createLogger({ pretty: false });
			expect(() => log.info("test message")).not.toThrow();
			expect(() => log.error("error message")).not.toThrow();
			expect(() => log.warn("warn message")).not.toThrow();
		});

		it("should log with context without throwing", () => {
			const log = createLogger({ pretty: false });
			expect(() => log.info({ sessionId: "abc123" }, "session started")).not.toThrow();
		});

		it("should support child loggers", () => {
			const log = createLogger({ name: "parent" });
			const child = log.child({ module: "child" });
			expect(child).toBeDefined();
			expect(typeof child.info).toBe("function");
		});
	});
});
