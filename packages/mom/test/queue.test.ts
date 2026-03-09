import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MomResponseSettingsProvider } from "../src/context.js";
import { type MomHandler, SlackBot, type SlackEvent } from "../src/slack.js";
import type { ChannelStore } from "../src/store.js";

// Mock @slack/socket-mode
vi.mock("@slack/socket-mode", () => ({
	SocketModeClient: vi.fn().mockImplementation(() => ({
		on: vi.fn(),
		start: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
	})),
}));

// Mock @slack/web-api
vi.mock("@slack/web-api", () => ({
	WebClient: vi.fn().mockImplementation(() => ({
		auth: {
			test: vi.fn().mockResolvedValue({ user_id: "BOT123" }),
		},
		chat: {
			postMessage: vi.fn().mockResolvedValue({ ts: "1234567890.123456" }),
			delete: vi.fn().mockResolvedValue({}),
		},
		conversations: {
			info: vi.fn().mockResolvedValue({ channel: { name: "test" } }),
			members: vi.fn().mockResolvedValue({ members: [] }),
			history: vi.fn().mockResolvedValue({ messages: [] }),
		},
		users: {
			info: vi.fn().mockResolvedValue({ user: { name: "testuser", real_name: "Test User" } }),
			list: vi.fn().mockResolvedValue({ members: [] }),
		},
		channels: {
			list: vi.fn().mockResolvedValue({ channels: [] }),
		},
	})),
}));

describe("SlackBot enqueueUserMessage", () => {
	let slackBot: SlackBot;
	let mockHandler: MomHandler;
	let mockWebClient: InstanceType<typeof import("@slack/web-api").WebClient>;
	let mockSettingsManager: MomResponseSettingsProvider;
	let mockStore: ChannelStore;

	const createSlackEvent = (overrides?: Partial<SlackEvent>): SlackEvent => ({
		type: "mention",
		channel: "C123ABC",
		ts: "1234567890.000001",
		user: "U123ABC",
		text: "@mom hello",
		...overrides,
	});

	beforeEach(() => {
		vi.clearAllMocks();

		// Create mock handler
		mockHandler = {
			isRunning: vi.fn().mockReturnValue(false),
			handleEvent: vi.fn().mockResolvedValue(undefined),
			handleStop: vi.fn().mockResolvedValue(undefined),
			getRunner: vi.fn().mockReturnValue(undefined),
		};

		// Create mock settings manager
		mockSettingsManager = {
			getResponseSettings: vi.fn().mockReturnValue({ mention: true, dm: true, channel: true }),
		};

		// Create mock store
		mockStore = {
			processAttachments: vi.fn().mockReturnValue([]),
		} as unknown as ChannelStore;

		// Create SlackBot instance
		slackBot = new SlackBot(mockHandler, {
			appToken: "xapp-test",
			botToken: "xoxb-test",
			workingDir: "/tmp/test-workspace",
			store: mockStore,
			settingsManager: mockSettingsManager,
		});

		// Get reference to the mocked WebClient for assertions
		mockWebClient = (slackBot as unknown as { webClient: typeof mockWebClient }).webClient;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("Enqueue when busy", () => {
		it("should send waiting prompt to user message thread when enqueued", async () => {
			const slackEvent1 = createSlackEvent({ ts: "1234567890.000001" });
			const slackEvent2 = createSlackEvent({ ts: "1234567890.000002" });

			// First message: handler is not running, starts processing
			vi.mocked(mockHandler.isRunning).mockReturnValueOnce(false);
			await slackBot.enqueueUserMessage(slackEvent1);

			// Second message: handler is running, should enqueue and send waiting prompt
			vi.mocked(mockHandler.isRunning).mockReturnValueOnce(true);
			await slackBot.enqueueUserMessage(slackEvent2);

			// Verify waiting prompt was sent to the second message's thread
			expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					channel: slackEvent2.channel,
					thread_ts: slackEvent2.ts,
					text: "_Queued. Will respond when current task finishes._",
				}),
			);
		});

		it("should use correct waiting prompt text", async () => {
			const slackEvent = createSlackEvent({ ts: "1234567890.000001" });

			// Handler is running
			vi.mocked(mockHandler.isRunning).mockReturnValue(true);
			await slackBot.enqueueUserMessage(slackEvent);

			// Verify exact waiting prompt text
			expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					text: "_Queued. Will respond when current task finishes._",
				}),
			);
		});
	});

	describe("Queue full", () => {
		it("should send queue full error when queue has 5 items", async () => {
			// Create 7 events: 6 to fill queue (first is processing, 5 queued), 7th triggers full
			const events = Array.from({ length: 7 }, (_, i) => createSlackEvent({ ts: `1234567890.00000${i + 1}` }));

			// Handler is always running (simulating a long task)
			vi.mocked(mockHandler.isRunning).mockReturnValue(true);

			// Mock handleEvent to never resolve so queue accumulates
			let resolveHandleEvent: () => void;
			const handleEventPromise = new Promise<void>((resolve) => {
				resolveHandleEvent = resolve;
			});
			vi.mocked(mockHandler.handleEvent).mockReturnValue(handleEventPromise);

			// Enqueue 6 messages (first starts processing, 5 accumulate in queue)
			for (let i = 0; i < 6; i++) {
				await slackBot.enqueueUserMessage(events[i]);
			}

			// Clear previous calls
			vi.mocked(mockWebClient.chat.postMessage).mockClear();

			// 7th message should trigger queue full error (queue has 5 items)
			await slackBot.enqueueUserMessage(events[6]);

			// Verify queue full error message
			expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					channel: events[6].channel,
					thread_ts: events[6].ts,
					text: "_Queue full. Please wait and try again._",
				}),
			);

			// Cleanup: resolve the hanging promise
			resolveHandleEvent!();
		});
	});

	describe("Message ordering", () => {
		it("should process enqueued messages in FIFO order", async () => {
			const events = [
				createSlackEvent({ text: "first message", ts: "1234567890.000001" }),
				createSlackEvent({ text: "second message", ts: "1234567890.000002" }),
				createSlackEvent({ text: "third message", ts: "1234567890.000003" }),
			];

			const processedOrder: string[] = [];

			// Mock handleEvent to track processing order
			vi.mocked(mockHandler.handleEvent).mockImplementation(async (event: SlackEvent) => {
				processedOrder.push(event.text);
			});

			// First message starts processing immediately (isRunning = false)
			vi.mocked(mockHandler.isRunning).mockReturnValueOnce(false);
			// Subsequent messages are queued (isRunning = true)
			vi.mocked(mockHandler.isRunning).mockReturnValue(true);

			// Enqueue all messages
			for (const event of events) {
				await slackBot.enqueueUserMessage(event);
			}

			// Wait for queue to process
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Assert FIFO order
			expect(processedOrder).toEqual(["first message", "second message", "third message"]);
		});
	});
});
