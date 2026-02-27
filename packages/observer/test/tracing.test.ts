import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getTracer,
	initTracing,
	isTelemetryEnabled,
	langfuseConfigToTracingConfig,
	safeSpanOperation,
	shutdownTracing,
} from "../src/tracing/index.js";

// Mock the OpenTelemetry SDK
vi.mock("@opentelemetry/sdk-node", () => {
	const mockStart = vi.fn();
	const mockShutdown = vi.fn().mockResolvedValue(undefined);
	return {
		NodeSDK: vi.fn().mockImplementation(() => ({
			start: mockStart,
			shutdown: mockShutdown,
		})),
	};
});

describe("Tracing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset telemetry state
		return shutdownTracing();
	});

	afterEach(async () => {
		await shutdownTracing();
	});

	describe("initTracing", () => {
		it("should return no-op shutdown when disabled", async () => {
			const shutdown = initTracing({ enabled: false });
			expect(typeof shutdown).toBe("function");
			expect(isTelemetryEnabled()).toBe(false);
			await shutdown();
		});

		it("should initialize with langfuse exporter config", () => {
			// Skip if no env vars - this tests config parsing only
			const shutdown = initTracing({
				enabled: true,
				exporters: [{ type: "langfuse" }],
			});
			expect(typeof shutdown).toBe("function");
		});

		it("should initialize with otlp exporter config", () => {
			const shutdown = initTracing({
				enabled: true,
				exporters: [{ type: "otlp", endpoint: "http://localhost:4318/v1/traces" }],
			});
			expect(typeof shutdown).toBe("function");
		});

		it("should handle multiple exporters", () => {
			const shutdown = initTracing({
				enabled: true,
				exporters: [{ type: "langfuse" }, { type: "otlp", endpoint: "http://localhost:4318/v1/traces" }],
			});
			expect(typeof shutdown).toBe("function");
		});
	});

	describe("isTelemetryEnabled", () => {
		it("should return false when not initialized", () => {
			expect(isTelemetryEnabled()).toBe(false);
		});
	});

	describe("getTracer", () => {
		it("should return undefined when telemetry is disabled", () => {
			const tracer = getTracer();
			expect(tracer).toBeUndefined();
		});
	});

	describe("safeSpanOperation", () => {
		it("should execute operation successfully", () => {
			const result = safeSpanOperation(() => 42, 0);
			expect(result).toBe(42);
		});

		it("should return fallback on error", () => {
			const result = safeSpanOperation(() => {
				throw new Error("test error");
			}, "fallback");
			expect(result).toBe("fallback");
		});

		it("should log warning on error", () => {
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			safeSpanOperation(() => {
				throw new Error("test error");
			}, "fallback");
			expect(warnSpy).toHaveBeenCalledWith("Telemetry operation failed:", expect.any(Error));
			warnSpy.mockRestore();
		});
	});

	describe("langfuseConfigToTracingConfig", () => {
		it("should convert enabled config correctly", () => {
			const result = langfuseConfigToTracingConfig({
				enabled: true,
				secretKey: "sk-test",
				publicKey: "pk-test",
				baseUrl: "https://test.langfuse.com",
			});

			expect(result.enabled).toBe(true);
			expect(result.exporters).toHaveLength(1);
			expect(result.exporters?.[0]).toEqual({
				type: "langfuse",
				secretKey: "sk-test",
				publicKey: "pk-test",
				baseUrl: "https://test.langfuse.com",
			});
		});

		it("should convert disabled config correctly", () => {
			const result = langfuseConfigToTracingConfig({ enabled: false });
			expect(result.enabled).toBe(false);
			expect(result.exporters).toHaveLength(1);
		});

		it("should handle partial config", () => {
			const result = langfuseConfigToTracingConfig({
				enabled: true,
				secretKey: "sk-test",
			});

			expect(result.enabled).toBe(true);
			expect(result.exporters?.[0]).toEqual({
				type: "langfuse",
				secretKey: "sk-test",
				publicKey: undefined,
				baseUrl: undefined,
			});
		});
	});
});
