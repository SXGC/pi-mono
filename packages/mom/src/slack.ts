import { isBuiltinCommand, parseSlashCommand } from "@mariozechner/pi-coding-agent";
import { SocketModeClient } from "@slack/socket-mode";
import type { KnownBlock } from "@slack/types";
import { WebClient } from "@slack/web-api";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import type { AgentRunner } from "./agent.js";
import type { MomResponseSettingsProvider } from "./context.js";
import * as log from "./log.js";
import type { Attachment, ChannelStore } from "./store.js";

const slackLog = log.createLogger("slack");
const CHAT_TEXT_CHUNK_CHAR_LIMIT = 4000;
const CHAT_TEXT_CHUNK_BYTE_LIMIT = 4000;

function getSlackErrorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object") return undefined;

	const topLevelError = (error as { error?: unknown }).error;
	if (typeof topLevelError === "string") {
		return topLevelError;
	}

	const data = (error as { data?: { error?: unknown } }).data;
	if (data && typeof data.error === "string") {
		return data.error;
	}

	const code = (error as { code?: unknown }).code;
	if (typeof code === "string") {
		return code;
	}

	return undefined;
}

function utf8ByteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

function takeChunkByBudget(
	text: string,
	maxChars: number,
	maxBytes: number,
): { chunk: string; consumedCodeUnits: number } {
	if (!text) return { chunk: "", consumedCodeUnits: 0 };

	let chars = 0;
	let bytes = 0;
	let consumedCodeUnits = 0;

	for (const ch of text) {
		const chBytes = utf8ByteLength(ch);
		if (chars + 1 > maxChars || bytes + chBytes > maxBytes) {
			break;
		}
		chars += 1;
		bytes += chBytes;
		consumedCodeUnits += ch.length;
	}

	if (consumedCodeUnits === 0) {
		const first = [...text][0] ?? "";
		return { chunk: first, consumedCodeUnits: first.length };
	}

	return {
		chunk: text.slice(0, consumedCodeUnits),
		consumedCodeUnits,
	};
}

function splitTextForSlack(text: string): string[] {
	let remaining = text.trim() || "(empty)";
	const chunks: string[] = [];

	while (remaining.length > 0) {
		const { chunk, consumedCodeUnits } = takeChunkByBudget(
			remaining,
			CHAT_TEXT_CHUNK_CHAR_LIMIT,
			CHAT_TEXT_CHUNK_BYTE_LIMIT,
		);

		if (!chunk || consumedCodeUnits <= 0) {
			break;
		}

		let finalChunk = chunk;
		let finalConsumed = consumedCodeUnits;

		if (consumedCodeUnits < remaining.length) {
			const splitAtNewline = finalChunk.lastIndexOf("\n");
			if (splitAtNewline > Math.floor(finalChunk.length * 0.5)) {
				const newlineChunk = finalChunk.slice(0, splitAtNewline).trimEnd();
				if (newlineChunk.length > 0) {
					finalChunk = newlineChunk;
					finalConsumed = newlineChunk.length;
				}
			}
		}

		chunks.push(finalChunk);
		remaining = remaining.slice(finalConsumed).replace(/^\n+/, "");
	}

	return chunks.length > 0 ? chunks : ["(empty)"];
}

// ============================================================================
// Types
// ============================================================================

// New Slack Block Kit types not yet in @slack/types
export interface MarkdownBlock {
	type: "markdown";
	text: string;
	block_id?: string;
}

export interface RichTextElement {
	type: "text";
	text: string;
	style?: { bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean };
}

export interface RichTextSection {
	type: "rich_text_section";
	elements: RichTextElement[];
}

export interface RichTextPreformatted {
	type: "rich_text_preformatted";
	elements: RichTextElement[];
	border?: 0 | 1;
}

export interface RichTextQuote {
	type: "rich_text_quote";
	elements: RichTextElement[];
	border?: 0 | 1;
}

export interface RichTextContent {
	type: "rich_text";
	elements: (RichTextSection | RichTextPreformatted | RichTextQuote)[];
	block_id?: string;
}

export interface TaskCardBlock {
	type: "task_card";
	task_id: string;
	title: string;
	status: "pending" | "in_progress" | "complete" | "error";
	details?: RichTextContent;
	output?: RichTextContent;
	sources?: Array<{ type: "url"; url: string; text: string }>;
	block_id?: string;
}

export type SlackBlock = KnownBlock | MarkdownBlock | TaskCardBlock;

export interface SlackEvent {
	type: "mention" | "dm";
	channel: string;
	ts: string;
	user: string;
	text: string;
	files?: Array<{ name?: string; url_private_download?: string; url_private?: string }>;
	/** Processed attachments with local paths (populated after logUserMessage) */
	attachments?: Attachment[];
}

export interface SlackUser {
	id: string;
	userName: string;
	displayName: string;
}

export interface SlackChannel {
	id: string;
	name: string;
}

// Types used by agent.ts
export interface ChannelInfo {
	id: string;
	name: string;
}

export interface UserInfo {
	id: string;
	userName: string;
	displayName: string;
}

export interface SlackContext {
	message: {
		text: string;
		rawText: string;
		user: string;
		userName?: string;
		channel: string;
		ts: string;
		attachments: Array<{ local: string }>;
	};
	channelName?: string;
	channels: ChannelInfo[];
	users: UserInfo[];
	respond: (text: string, shouldLog?: boolean) => Promise<void>;
	replaceMessage: (text: string) => Promise<void>;
	replaceMessageBlocks: (blocks: SlackBlock[], fallbackText: string) => Promise<void>;
	respondInThread: (text: string) => Promise<void>;
	respondBlocksInThread: (blocks: SlackBlock[], fallbackText: string) => Promise<string | undefined>;
	updateThreadBlocks: (threadMessageTs: string, blocks: SlackBlock[], fallbackText: string) => Promise<void>;
	setTyping: (isTyping: boolean) => Promise<void>;
	uploadFile: (filePath: string, title?: string) => Promise<void>;
	setWorking: (working: boolean) => Promise<void>;
	deleteMessage: () => Promise<void>;
}

export interface MomHandler {
	/**
	 * Check if channel is currently running (SYNC)
	 */
	isRunning(channelId: string): boolean;

	/**
	 * Handle an event that triggers mom (ASYNC)
	 * Called only when isRunning() returned false for user messages.
	 * Events always queue and pass isEvent=true.
	 */
	handleEvent(event: SlackEvent, slack: SlackBot, isEvent?: boolean): Promise<void>;

	/**
	 * Handle stop command (ASYNC)
	 * Called when user says "stop" while mom is running
	 */
	handleStop(channelId: string, slack: SlackBot): Promise<void>;

	getRunner(channelId: string): AgentRunner | undefined;
}

type SlackSendTarget = "main" | "thread" | "main-update" | "thread-update" | "delete" | "upload";

// ============================================================================
// Per-channel queue for sequential processing
// ============================================================================

type QueuedWork = () => Promise<void>;

class ChannelQueue {
	private queue: QueuedWork[] = [];
	private processing = false;

	enqueue(work: QueuedWork): void {
		this.queue.push(work);
		this.processNext();
	}

	size(): number {
		return this.queue.length;
	}

	private async processNext(): Promise<void> {
		if (this.processing || this.queue.length === 0) return;
		this.processing = true;
		const work = this.queue.shift()!;
		try {
			await work();
		} catch (err) {
			slackLog.error("Queue error", err instanceof Error ? err.message : String(err));
		}
		this.processing = false;
		this.processNext();
	}
}

// ============================================================================
// SlackBot
// ============================================================================

export class SlackBot {
	private socketClient: SocketModeClient;
	private webClient: WebClient;
	private handler: MomHandler;
	private workingDir: string;
	private store: ChannelStore;
	private responseSettingsProvider: MomResponseSettingsProvider;
	private botUserId: string | null = null;
	private startupTs: string | null = null; // Messages older than this are just logged, not processed
	private reconnectAttempts = 0;

	private users = new Map<string, SlackUser>();
	private channels = new Map<string, SlackChannel>();
	private queues = new Map<string, ChannelQueue>();

	constructor(
		handler: MomHandler,
		config: {
			appToken: string;
			botToken: string;
			workingDir: string;
			store: ChannelStore;
			settingsManager: MomResponseSettingsProvider;
		},
	) {
		this.handler = handler;
		this.workingDir = config.workingDir;
		this.store = config.store;
		this.responseSettingsProvider = config.settingsManager;
		this.socketClient = new SocketModeClient({
			appToken: config.appToken,
			clientPingTimeout: 10_000,
			serverPingTimeout: 30_000,
		});
		this.webClient = new WebClient(config.botToken);
	}

	// ==========================================================================
	// Public API
	// ==========================================================================

	async start(): Promise<void> {
		const auth = await this.webClient.auth.test();
		this.botUserId = auth.user_id as string;

		await Promise.all([this.fetchUsers(), this.fetchChannels()]);
		slackLog.info(`Loaded ${this.channels.size} channels, ${this.users.size} users`);

		await this.backfillAllChannels();

		this.setupConnectionHandlers();
		this.setupEventHandlers();
		await this.socketClient.start();

		// Record startup time - messages older than this are just logged, not processed
		this.startupTs = (Date.now() / 1000).toFixed(6);

		log.logConnected();
	}

	getUser(userId: string): SlackUser | undefined {
		return this.users.get(userId);
	}

	getChannel(channelId: string): SlackChannel | undefined {
		return this.channels.get(channelId);
	}

	getAllUsers(): SlackUser[] {
		return Array.from(this.users.values());
	}

	getAllChannels(): SlackChannel[] {
		return Array.from(this.channels.values());
	}

	private logSendAttempt(input: {
		operation: string;
		target: SlackSendTarget;
		channel: string;
		text?: string;
		blocksCount?: number;
		blocksJsonSize?: number;
		blocksJsonUtf8Bytes?: number;
		messageTs?: string;
		threadTs?: string;
		filePath?: string;
		title?: string;
	}): void {
		const messageCharLength = input.text?.length ?? 0;
		const messageUtf8Bytes = input.text ? utf8ByteLength(input.text) : 0;
		const normalizedPreview = input.text ? input.text.replace(/\s+/g, " ").trim() : "";
		const preview =
			normalizedPreview.length > 0
				? normalizedPreview.length > 180
					? `${normalizedPreview.substring(0, 177)}...`
					: normalizedPreview
				: undefined;
		slackLog.info("Slack send attempt", {
			channelId: input.channel,
			channelName: this.channels.get(input.channel)?.name,
			operation: input.operation,
			target: input.target,
			messageLength: messageCharLength,
			messageCharLength,
			messageUtf8Bytes,
			blocksCount: input.blocksCount,
			blocksJsonSize: input.blocksJsonSize,
			blocksJsonUtf8Bytes: input.blocksJsonUtf8Bytes,
			messageTs: input.messageTs,
			threadTs: input.threadTs,
			filePath: input.filePath,
			title: input.title,
			preview,
		});
	}

	private async postSplitChunksInThread(
		channel: string,
		threadTs: string,
		chunks: string[],
		operationPrefix: string,
	): Promise<void> {
		for (let index = 0; index < chunks.length; index++) {
			const chunk = chunks[index];
			this.logSendAttempt({
				operation: `${operationPrefix}-${index + 1}`,
				target: "thread",
				channel,
				text: chunk,
				threadTs,
			});
			await this.webClient.chat.postMessage({ channel, thread_ts: threadTs, text: chunk });
		}
	}

	async postMessage(channel: string, text: string): Promise<string> {
		this.logSendAttempt({
			operation: "postMessage",
			target: "main",
			channel,
			text,
		});
		const result = await this.webClient.chat.postMessage({ channel, text });
		return result.ts as string;
	}

	async postMessageBlocks(channel: string, text: string, blocks: SlackBlock[]): Promise<string> {
		const blocksJson = JSON.stringify(blocks);
		const blocksJsonUtf8Bytes = utf8ByteLength(blocksJson);
		this.logSendAttempt({
			operation: "postMessageBlocks",
			target: "main",
			channel,
			text,
			blocksCount: blocks.length,
			blocksJsonSize: blocksJson.length,
			blocksJsonUtf8Bytes,
		});
		try {
			const result = await this.webClient.chat.postMessage({ channel, text, blocks });
			return result.ts as string;
		} catch (error) {
			const errorCode = getSlackErrorCode(error);
			if (errorCode === "msg_too_long" || errorCode === "msg_blocks_too_long") {
				const chunks = splitTextForSlack(text);
				slackLog.warning(
					"Slack rejected postMessageBlocks payload, splitting into multiple text messages",
					undefined,
					{
						channelId: channel,
						errorCode,
						chunkCount: chunks.length,
						originalLength: text.length,
						originalUtf8Bytes: utf8ByteLength(text),
						blocksCount: blocks.length,
						blocksJsonSize: blocksJson.length,
						blocksJsonUtf8Bytes,
					},
				);

				this.logSendAttempt({
					operation: "postMessageBlocksSplitMain",
					target: "main",
					channel,
					text: chunks[0],
				});
				const mainResult = await this.webClient.chat.postMessage({ channel, text: chunks[0] });
				const mainTs = mainResult.ts as string;

				if (chunks.length > 1) {
					await this.postSplitChunksInThread(channel, mainTs, chunks.slice(1), "postMessageBlocksSplitThread");
				}

				return mainTs;
			}

			throw error;
		}
	}

	async updateMessage(channel: string, ts: string, text: string): Promise<void> {
		this.logSendAttempt({
			operation: "updateMessage",
			target: "main-update",
			channel,
			text,
			messageTs: ts,
		});

		try {
			await this.webClient.chat.update({ channel, ts, text });
		} catch (error) {
			const errorCode = getSlackErrorCode(error);
			if (errorCode === "msg_too_long") {
				const chunks = splitTextForSlack(text);
				slackLog.warning("Slack msg_too_long on updateMessage, splitting into multiple messages", undefined, {
					channelId: channel,
					messageTs: ts,
					errorCode,
					chunkCount: chunks.length,
					originalLength: text.length,
					originalUtf8Bytes: utf8ByteLength(text),
				});
				this.logSendAttempt({
					operation: "updateMessageSplitMain",
					target: "main-update",
					channel,
					text: chunks[0],
					messageTs: ts,
				});
				await this.webClient.chat.update({ channel, ts, text: chunks[0] });

				if (chunks.length > 1) {
					await this.postSplitChunksInThread(channel, ts, chunks.slice(1), "updateMessageSplitThread");
				}

				return;
			}

			throw error;
		}
	}

	async updateMessageBlocks(
		channel: string,
		ts: string,
		text: string,
		blocks: SlackBlock[],
		target: "main-update" | "thread-update" = "main-update",
	): Promise<void> {
		const blocksJson = JSON.stringify(blocks);
		const blocksJsonUtf8Bytes = utf8ByteLength(blocksJson);
		this.logSendAttempt({
			operation: "updateMessageBlocks",
			target,
			channel,
			text,
			blocksCount: blocks.length,
			blocksJsonSize: blocksJson.length,
			blocksJsonUtf8Bytes,
			messageTs: ts,
		});

		try {
			await this.webClient.chat.update({ channel, ts, text, blocks });
		} catch (error) {
			const errorCode = getSlackErrorCode(error);

			if (errorCode === "msg_blocks_too_long" || errorCode === "msg_too_long") {
				const chunks = splitTextForSlack(text);
				slackLog.warning("Slack rejected update payload, splitting into multiple text messages", undefined, {
					channelId: channel,
					messageTs: ts,
					errorCode,
					chunkCount: chunks.length,
					originalLength: text.length,
					originalUtf8Bytes: utf8ByteLength(text),
					blocksCount: blocks.length,
					blocksJsonSize: blocksJson.length,
					blocksJsonUtf8Bytes,
					splitMainLength: chunks[0].length,
					splitMainUtf8Bytes: utf8ByteLength(chunks[0]),
				});
				this.logSendAttempt({
					operation: "updateMessageBlocksSplitMain",
					target,
					channel,
					text: chunks[0],
					messageTs: ts,
				});
				await this.webClient.chat.update({ channel, ts, text: chunks[0] });

				if (chunks.length > 1) {
					await this.postSplitChunksInThread(channel, ts, chunks.slice(1), "updateMessageBlocksSplitThread");
				}

				return;
			}

			throw error;
		}
	}

	async deleteMessage(channel: string, ts: string): Promise<void> {
		this.logSendAttempt({
			operation: "deleteMessage",
			target: "delete",
			channel,
			messageTs: ts,
		});
		await this.webClient.chat.delete({ channel, ts });
	}

	async postInThread(channel: string, threadTs: string, text: string): Promise<string> {
		this.logSendAttempt({
			operation: "postInThread",
			target: "thread",
			channel,
			text,
			threadTs,
		});
		const result = await this.webClient.chat.postMessage({ channel, thread_ts: threadTs, text });
		return result.ts as string;
	}

	async postInThreadBlocks(channel: string, threadTs: string, text: string, blocks: SlackBlock[]): Promise<string> {
		const blocksJson = JSON.stringify(blocks);
		const blocksJsonUtf8Bytes = utf8ByteLength(blocksJson);
		this.logSendAttempt({
			operation: "postInThreadBlocks",
			target: "thread",
			channel,
			text,
			blocksCount: blocks.length,
			blocksJsonSize: blocksJson.length,
			blocksJsonUtf8Bytes,
			threadTs,
		});
		try {
			const result = await this.webClient.chat.postMessage({
				channel,
				thread_ts: threadTs,
				text,
				blocks,
			});
			return result.ts as string;
		} catch (error) {
			const errorCode = getSlackErrorCode(error);
			if (errorCode === "msg_too_long" || errorCode === "msg_blocks_too_long") {
				const chunks = splitTextForSlack(text);
				slackLog.warning(
					"Slack rejected postInThreadBlocks payload, splitting into multiple text messages",
					undefined,
					{
						channelId: channel,
						threadTs,
						errorCode,
						chunkCount: chunks.length,
						originalLength: text.length,
						originalUtf8Bytes: utf8ByteLength(text),
						blocksCount: blocks.length,
						blocksJsonSize: blocksJson.length,
						blocksJsonUtf8Bytes,
					},
				);

				this.logSendAttempt({
					operation: "postInThreadBlocksSplitMain",
					target: "thread",
					channel,
					text: chunks[0],
					threadTs,
				});
				const firstResult = await this.webClient.chat.postMessage({
					channel,
					thread_ts: threadTs,
					text: chunks[0],
				});

				if (chunks.length > 1) {
					await this.postSplitChunksInThread(channel, threadTs, chunks.slice(1), "postInThreadBlocksSplitThread");
				}

				return firstResult.ts as string;
			}

			throw error;
		}
	}

	async uploadFile(channel: string, filePath: string, title?: string): Promise<void> {
		const fileName = title || basename(filePath);
		this.logSendAttempt({
			operation: "uploadFile",
			target: "upload",
			channel,
			filePath,
			title: fileName,
			text: fileName,
		});
		const fileContent = readFileSync(filePath);
		await this.webClient.files.uploadV2({
			channel_id: channel,
			file: fileContent,
			filename: fileName,
			title: fileName,
		});
	}

	/**
	 * Log a message to log.jsonl (SYNC)
	 * This is the ONLY place messages are written to log.jsonl
	 */
	logToFile(channel: string, entry: object): void {
		const dir = join(this.workingDir, channel);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		appendFileSync(join(dir, "log.jsonl"), `${JSON.stringify(entry)}\n`);
	}

	/**
	 * Log a bot response to log.jsonl
	 */
	logBotResponse(channel: string, text: string, ts: string): void {
		this.logToFile(channel, {
			date: new Date().toISOString(),
			ts,
			user: "bot",
			text,
			attachments: [],
			isBot: true,
		});
	}

	// ==========================================================================
	// Events Integration
	// ==========================================================================

	/**
	 * Enqueue an event for processing. Always queues (no "already working" rejection).
	 * Returns true if enqueued, false if queue is full (max 5).
	 */
	enqueueEvent(event: SlackEvent): boolean {
		const queue = this.getQueue(event.channel);
		if (queue.size() >= 5) {
			slackLog.warning(`Event queue full for ${event.channel}, discarding: ${event.text.substring(0, 50)}`);
			return false;
		}
		slackLog.info(`Enqueueing event for ${event.channel}: ${event.text.substring(0, 50)}`);
		queue.enqueue(() => this.handler.handleEvent(event, this, true));
		return true;
	}

	/**
	 * Enqueue a user message for processing. Sends waiting prompt when queued.
	 * Returns void, but sends queue full error if queue is full (max 5).
	 */
	async enqueueUserMessage(slackEvent: SlackEvent): Promise<void> {
		const queue = this.getQueue(slackEvent.channel);

		// Check queue full (5 items already in queue)
		if (queue.size() >= 5) {
			await this.postInThread(slackEvent.channel, slackEvent.ts, "_Queue full. Please wait and try again._");
			return;
		}

		// Check if currently running
		if (this.handler.isRunning(slackEvent.channel)) {
			// Send waiting prompt to user's message thread
			await this.postInThread(
				slackEvent.channel,
				slackEvent.ts,
				"_Queued. Will respond when current task finishes._",
			);
			// Enqueue for later processing
			queue.enqueue(() => this.handler.handleEvent(slackEvent, this));
		} else {
			// Not running, process immediately
			queue.enqueue(() => this.handler.handleEvent(slackEvent, this));
		}
	}

	// ==========================================================================
	// Private - Event Handlers
	// ==========================================================================

	private getQueue(channelId: string): ChannelQueue {
		let queue = this.queues.get(channelId);
		if (!queue) {
			queue = new ChannelQueue();
			this.queues.set(channelId, queue);
		}
		return queue;
	}

	private setupConnectionHandlers(): void {
		this.socketClient.on("connecting", () => {
			slackLog.info("Socket Mode connecting");
		});

		this.socketClient.on("reconnecting", () => {
			this.reconnectAttempts += 1;
			slackLog.warning(`Socket Mode reconnecting (attempt ${this.reconnectAttempts})`);
		});

		this.socketClient.on("connected", () => {
			if (this.reconnectAttempts > 0) {
				slackLog.info(`Socket Mode reconnected after ${this.reconnectAttempts} attempt(s)`);
			}
			this.reconnectAttempts = 0;
		});

		this.socketClient.on("close", () => {
			slackLog.warning("Socket Mode connection closed");
		});

		this.socketClient.on("disconnect", (reason: unknown) => {
			slackLog.warning("Socket Mode disconnected", reason instanceof Error ? reason.message : String(reason));
		});

		this.socketClient.on("disconnected", (reason: unknown) => {
			slackLog.warning("Socket Mode disconnected", reason instanceof Error ? reason.message : String(reason));
		});

		this.socketClient.on("error", (error: unknown) => {
			slackLog.warning("Socket Mode error", error instanceof Error ? error.message : String(error));
		});
	}

	private setupEventHandlers(): void {
		const safeAck = (
			ack: () => Promise<unknown> | unknown,
			eventType: "app_mention" | "message",
			channel: string,
		) => {
			void Promise.resolve()
				.then(() => ack())
				.catch((error: unknown) => {
					slackLog.error(
						`[${channel}] Failed to ack ${eventType}`,
						error instanceof Error ? error.message : String(error),
					);
				});
		};

		// Channel @mentions
		this.socketClient.on("app_mention", ({ event, ack }) => {
			const e = event as {
				text: string;
				channel: string;
				user: string;
				ts: string;
				files?: Array<{ name: string; url_private_download?: string; url_private?: string }>;
			};

			// Skip DMs (handled by message event)
			if (e.channel.startsWith("D")) {
				safeAck(ack, "app_mention", e.channel);
				return;
			}

			// Check if mentions are enabled
			const responseSettings = this.responseSettingsProvider.getResponseSettings();
			if (!responseSettings.mention) {
				safeAck(ack, "app_mention", e.channel);
				return;
			}
			const slackEvent: SlackEvent = {
				type: "mention",
				channel: e.channel,
				ts: e.ts,
				user: e.user,
				text: e.text.replace(/<@[A-Z0-9]+>/gi, "").trim(),
				files: e.files,
			};

			// SYNC: Log to log.jsonl (ALWAYS, even for old messages)
			// Also downloads attachments in background and stores local paths
			slackEvent.attachments = this.logUserMessage(slackEvent);

			// Only trigger processing for messages AFTER startup (not replayed old messages)
			if (this.startupTs && e.ts < this.startupTs) {
				slackLog.info(
					`[${e.channel}] Logged old message (pre-startup), not triggering: ${slackEvent.text.substring(0, 30)}`,
				);
				safeAck(ack, "app_mention", e.channel);
				return;
			}

			// Check for stop command - execute immediately, don't queue!
			if (slackEvent.text.toLowerCase().trim() === "stop") {
				if (this.handler.isRunning(e.channel)) {
					this.handler.handleStop(e.channel, this).catch((error: unknown) => {
						slackLog.error(
							`[${e.channel}] Failed to handle stop command`,
							error instanceof Error ? error.message : String(error),
						);
					}); // Don't await, don't queue
				} else {
					this.postMessage(e.channel, "_Nothing running_").catch((error: unknown) => {
						slackLog.error(
							`[${e.channel}] Failed to post stop status`,
							error instanceof Error ? error.message : String(error),
						);
					});
				}
				safeAck(ack, "app_mention", e.channel);
				return;
			}

			const parsed = parseSlashCommand(slackEvent.text);
			if (parsed && isBuiltinCommand(parsed.name)) {
				this.getQueue(e.channel).enqueue(async () => {
					const runner = this.handler.getRunner(e.channel);
					if (!runner) {
						await this.postMessage(e.channel, "_No runner available_");
						return;
					}

					const result = await runner.executeBuiltinCommand(parsed.name, parsed.args);
					if (result.message) {
						await this.postMessage(e.channel, result.success ? result.message : `_${result.message}_`);
					}
					if (result.error) {
						await this.postMessage(e.channel, `_Error: ${result.error}_`);
					}
				});
				safeAck(ack, "app_mention", e.channel);
				return;
			}

			// Enqueue message (handles both running and not running states)
			this.enqueueUserMessage(slackEvent).catch((error: unknown) => {
				slackLog.error(
					`[${slackEvent.channel}] Failed to enqueue user message`,
					error instanceof Error ? error.message : String(error),
				);
			});

			safeAck(ack, "app_mention", e.channel);
		});

		// All messages (for logging) + DMs (for triggering)
		this.socketClient.on("message", ({ event, ack }) => {
			const e = event as {
				text?: string;
				channel: string;
				user?: string;
				ts: string;
				channel_type?: string;
				subtype?: string;
				bot_id?: string;
				files?: Array<{ name: string; url_private_download?: string; url_private?: string }>;
			};

			// Skip bot messages, edits, etc.
			if (e.bot_id || !e.user || e.user === this.botUserId) {
				safeAck(ack, "message", e.channel);
				return;
			}
			if (e.subtype !== undefined && e.subtype !== "file_share") {
				safeAck(ack, "message", e.channel);
				return;
			}
			if (!e.text && (!e.files || e.files.length === 0)) {
				safeAck(ack, "message", e.channel);
				return;
			}

			const isDM = e.channel_type === "im";
			const isBotMention = e.text?.includes(`<@${this.botUserId}>`);

			// Skip channel @mentions - already handled by app_mention event
			if (!isDM && isBotMention) {
				safeAck(ack, "message", e.channel);
				return;
			}

			// Check response settings based on message type
			const responseSettings = this.responseSettingsProvider.getResponseSettings();
			if (isDM && !responseSettings.dm) {
				safeAck(ack, "message", e.channel);
				return;
			}
			if (!isDM && !responseSettings.channel) {
				safeAck(ack, "message", e.channel);
				return;
			}

			const slackEvent: SlackEvent = {
				type: isDM ? "dm" : "mention",
				channel: e.channel,
				ts: e.ts,
				user: e.user,
				text: (e.text || "").replace(/<@[A-Z0-9]+>/gi, "").trim(),
				files: e.files,
			};

			// SYNC: Log to log.jsonl (ALL messages - channel chatter and DMs)
			// Also downloads attachments in background and stores local paths
			slackEvent.attachments = this.logUserMessage(slackEvent);

			// Only trigger processing for messages AFTER startup (not replayed old messages)
			if (this.startupTs && e.ts < this.startupTs) {
				slackLog.info(`[${e.channel}] Skipping old message (pre-startup): ${slackEvent.text.substring(0, 30)}`);
				safeAck(ack, "message", e.channel);
				return;
			}

			// Trigger handler for DMs and channel messages (not @mentions which are handled by app_mention)
			// Check for stop command - execute immediately, don't queue!
			if (slackEvent.text.toLowerCase().trim() === "stop") {
				if (this.handler.isRunning(e.channel)) {
					this.handler.handleStop(e.channel, this).catch((error: unknown) => {
						slackLog.error(
							`[${e.channel}] Failed to handle stop command`,
							error instanceof Error ? error.message : String(error),
						);
					}); // Don't await, don't queue
				} else {
					this.postMessage(e.channel, "_Nothing running_").catch((error: unknown) => {
						slackLog.error(
							`[${e.channel}] Failed to post stop status`,
							error instanceof Error ? error.message : String(error),
						);
					});
				}
				safeAck(ack, "message", e.channel);
				return;
			}

			const parsed = parseSlashCommand(slackEvent.text);
			if (parsed && isBuiltinCommand(parsed.name)) {
				this.getQueue(e.channel).enqueue(async () => {
					const runner = this.handler.getRunner(e.channel);
					if (!runner) {
						await this.postMessage(e.channel, "_No runner available_");
						return;
					}

					const result = await runner.executeBuiltinCommand(parsed.name, parsed.args);
					if (result.message) {
						await this.postMessage(e.channel, result.success ? result.message : `_${result.message}_`);
					}
					if (result.error) {
						await this.postMessage(e.channel, `_Error: ${result.error}_`);
					}
				});
				safeAck(ack, "message", e.channel);
				return;
			}

			// Enqueue message (handles both running and not running states)
			this.enqueueUserMessage(slackEvent).catch((error: unknown) => {
				slackLog.error(
					`[${e.channel}] Failed to enqueue message`,
					error instanceof Error ? error.message : String(error),
				);
			});

			safeAck(ack, "message", e.channel);
		});
	}

	/**
	 * Log a user message to log.jsonl (SYNC)
	 * Downloads attachments in background via store
	 */
	private logUserMessage(event: SlackEvent): Attachment[] {
		const user = this.users.get(event.user);
		// Process attachments - queues downloads in background
		const attachments = event.files ? this.store.processAttachments(event.channel, event.files, event.ts) : [];
		this.logToFile(event.channel, {
			date: new Date(parseFloat(event.ts) * 1000).toISOString(),
			ts: event.ts,
			user: event.user,
			userName: user?.userName,
			displayName: user?.displayName,
			text: event.text,
			attachments,
			isBot: false,
		});
		return attachments;
	}

	// ==========================================================================
	// Private - Backfill
	// ==========================================================================

	private getExistingTimestamps(channelId: string): Set<string> {
		const logPath = join(this.workingDir, channelId, "log.jsonl");
		const timestamps = new Set<string>();
		if (!existsSync(logPath)) return timestamps;

		const content = readFileSync(logPath, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);
		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.ts) timestamps.add(entry.ts);
			} catch {}
		}
		return timestamps;
	}

	private async backfillChannel(channelId: string): Promise<number> {
		const existingTs = this.getExistingTimestamps(channelId);

		// Find the biggest ts in log.jsonl
		let latestTs: string | undefined;
		for (const ts of existingTs) {
			if (!latestTs || parseFloat(ts) > parseFloat(latestTs)) latestTs = ts;
		}

		type Message = {
			user?: string;
			bot_id?: string;
			text?: string;
			ts?: string;
			subtype?: string;
			files?: Array<{ name: string }>;
		};
		const allMessages: Message[] = [];

		let cursor: string | undefined;
		let pageCount = 0;
		const maxPages = 3;

		do {
			const result = await this.webClient.conversations.history({
				channel: channelId,
				oldest: latestTs, // Only fetch messages newer than what we have
				inclusive: false,
				limit: 1000,
				cursor,
			});
			if (result.messages) {
				allMessages.push(...(result.messages as Message[]));
			}
			cursor = result.response_metadata?.next_cursor;
			pageCount++;
		} while (cursor && pageCount < maxPages);

		// Filter: include mom's messages, exclude other bots, skip already logged
		const relevantMessages = allMessages.filter((msg) => {
			if (!msg.ts || existingTs.has(msg.ts)) return false; // Skip duplicates
			if (msg.user === this.botUserId) return true;
			if (msg.bot_id) return false;
			if (msg.subtype !== undefined && msg.subtype !== "file_share") return false;
			if (!msg.user) return false;
			if (!msg.text && (!msg.files || msg.files.length === 0)) return false;
			return true;
		});

		// Reverse to chronological order
		relevantMessages.reverse();

		// Log each message to log.jsonl
		for (const msg of relevantMessages) {
			const isMomMessage = msg.user === this.botUserId;
			const user = this.users.get(msg.user!);
			// Strip @mentions from text (same as live messages)
			const text = (msg.text || "").replace(/<@[A-Z0-9]+>/gi, "").trim();
			// Process attachments - queues downloads in background
			const attachments = msg.files ? this.store.processAttachments(channelId, msg.files, msg.ts!) : [];

			this.logToFile(channelId, {
				date: new Date(parseFloat(msg.ts!) * 1000).toISOString(),
				ts: msg.ts!,
				user: isMomMessage ? "bot" : msg.user!,
				userName: isMomMessage ? undefined : user?.userName,
				displayName: isMomMessage ? undefined : user?.displayName,
				text,
				attachments,
				isBot: isMomMessage,
			});
		}

		return relevantMessages.length;
	}

	private async backfillAllChannels(): Promise<void> {
		const startTime = Date.now();

		// Only backfill channels that already have a log.jsonl (mom has interacted with them before)
		const channelsToBackfill: Array<[string, SlackChannel]> = [];
		for (const [channelId, channel] of this.channels) {
			const logPath = join(this.workingDir, channelId, "log.jsonl");
			if (existsSync(logPath)) {
				channelsToBackfill.push([channelId, channel]);
			}
		}

		slackLog.backfillStart(channelsToBackfill.length);

		let totalMessages = 0;
		for (const [channelId, channel] of channelsToBackfill) {
			try {
				const count = await this.backfillChannel(channelId);
				if (count > 0) slackLog.backfillChannel(channel.name, count);
				totalMessages += count;
			} catch (error) {
				slackLog.error(`Failed to backfill #${channel.name}`, String(error));
			}
		}

		const durationMs = Date.now() - startTime;
		slackLog.backfillComplete(totalMessages, durationMs);
	}

	// ==========================================================================
	// Private - Fetch Users/Channels
	// ==========================================================================

	private async fetchUsers(): Promise<void> {
		let cursor: string | undefined;
		do {
			const result = await this.webClient.users.list({ limit: 200, cursor });
			const members = result.members as
				| Array<{ id?: string; name?: string; real_name?: string; deleted?: boolean }>
				| undefined;
			if (members) {
				for (const u of members) {
					if (u.id && u.name && !u.deleted) {
						this.users.set(u.id, { id: u.id, userName: u.name, displayName: u.real_name || u.name });
					}
				}
			}
			cursor = result.response_metadata?.next_cursor;
		} while (cursor);
	}

	private async fetchChannels(): Promise<void> {
		// Fetch public/private channels
		let cursor: string | undefined;
		do {
			const result = await this.webClient.conversations.list({
				types: "public_channel,private_channel",
				exclude_archived: true,
				limit: 200,
				cursor,
			});
			const channels = result.channels as Array<{ id?: string; name?: string; is_member?: boolean }> | undefined;
			if (channels) {
				for (const c of channels) {
					if (c.id && c.name && c.is_member) {
						this.channels.set(c.id, { id: c.id, name: c.name });
					}
				}
			}
			cursor = result.response_metadata?.next_cursor;
		} while (cursor);

		// Also fetch DM channels (IMs)
		cursor = undefined;
		do {
			const result = await this.webClient.conversations.list({
				types: "im",
				limit: 200,
				cursor,
			});
			const ims = result.channels as Array<{ id?: string; user?: string }> | undefined;
			if (ims) {
				for (const im of ims) {
					if (im.id) {
						// Use user's name as channel name for DMs
						const user = im.user ? this.users.get(im.user) : undefined;
						const name = user ? `DM:${user.userName}` : `DM:${im.id}`;
						this.channels.set(im.id, { id: im.id, name });
					}
				}
			}
			cursor = result.response_metadata?.next_cursor;
		} while (cursor);
	}
}
