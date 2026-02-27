import { LogLevel, WebClient } from "@slack/web-api";
import { log } from "./log.js";

interface Message {
	ts: string;
	user?: string;
	text?: string;
	thread_ts?: string;
	reply_count?: number;
	files?: Array<{ name: string; url_private?: string }>;
}

function formatTs(ts: string): string {
	const date = new Date(parseFloat(ts) * 1000);
	return date
		.toISOString()
		.replace("T", " ")
		.replace(/\.\d+Z$/, "");
}

function formatMessage(ts: string, user: string, text: string, indent = ""): string {
	const prefix = `[${formatTs(ts)}] ${user}: `;
	const lines = text.split("\n");
	const firstLine = `${indent}${prefix}${lines[0]}`;
	if (lines.length === 1) return firstLine;
	// All continuation lines get same indent as content start
	const contentIndent = indent + " ".repeat(prefix.length);
	return [firstLine, ...lines.slice(1).map((l) => contentIndent + l)].join("\n");
}

export async function downloadChannel(channelId: string, botToken: string): Promise<void> {
	const client = new WebClient(botToken, { logLevel: LogLevel.ERROR });

	log.debug({ channelId }, "Fetching channel info");

	// Get channel info
	let channelName = channelId;
	try {
		const info = await client.conversations.info({ channel: channelId });
		channelName = (info.channel as any)?.name || channelId;
	} catch {
		// DM channels don't have names, that's fine
	}

	log.info({ channelId, channelName }, `Downloading history for #${channelName}`);

	// Fetch all messages
	const messages: Message[] = [];
	let cursor: string | undefined;

	do {
		const response = await client.conversations.history({
			channel: channelId,
			limit: 200,
			cursor,
		});

		if (response.messages) {
			messages.push(...(response.messages as Message[]));
		}

		cursor = response.response_metadata?.next_cursor;
		log.debug({ messageCount: messages.length }, `Fetched ${messages.length} messages`);
	} while (cursor);

	// Reverse to chronological order
	messages.reverse();

	// Build map of thread replies
	const threadReplies = new Map<string, Message[]>();
	const threadsToFetch = messages.filter((m) => m.reply_count && m.reply_count > 0);

	log.debug({ threadCount: threadsToFetch.length }, `Fetching ${threadsToFetch.length} threads`);

	for (let i = 0; i < threadsToFetch.length; i++) {
		const parent = threadsToFetch[i];
		log.debug(
			{ threadIndex: i + 1, total: threadsToFetch.length, replyCount: parent.reply_count },
			`Thread ${i + 1}/${threadsToFetch.length}`,
		);

		const replies: Message[] = [];
		let threadCursor: string | undefined;

		do {
			const response = await client.conversations.replies({
				channel: channelId,
				ts: parent.ts,
				limit: 200,
				cursor: threadCursor,
			});

			if (response.messages) {
				// Skip the first message (it's the parent)
				replies.push(...(response.messages as Message[]).slice(1));
			}

			threadCursor = response.response_metadata?.next_cursor;
		} while (threadCursor);

		threadReplies.set(parent.ts, replies);
	}

	// Output messages with thread replies interleaved
	let totalReplies = 0;
	for (const msg of messages) {
		// Output the message
		console.log(formatMessage(msg.ts, msg.user || "unknown", msg.text || ""));

		// Output thread replies right after parent (indented)
		const replies = threadReplies.get(msg.ts);
		if (replies) {
			for (const reply of replies) {
				console.log(formatMessage(reply.ts, reply.user || "unknown", reply.text || "", "  "));
				totalReplies++;
			}
		}
	}

	log.info(
		{ messageCount: messages.length, replyCount: totalReplies },
		`Done! ${messages.length} messages, ${totalReplies} thread replies`,
	);
}
