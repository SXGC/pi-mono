import type { SlackBlock } from "./slack.js";

export interface SlackBlockPayload {
	blocks: SlackBlock[];
	fallbackText: string;
}

type MarkdownKind = "thinking" | "text";
type TaskStatus = "in_progress" | "complete" | "error";

const MRKDWN_MAX = 2800;
const CODE_BLOCK_MAX = 1800;

function escapeMrkdwn(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max - 3)}...`;
}

function asCodeBlock(text: string, maxLen: number): string {
	const normalized = truncate(text.trim(), maxLen);
	return `\`\`\`\n${normalized}\n\`\`\``;
}

export function buildMarkdownPayload(text: string, kind: MarkdownKind): SlackBlockPayload {
	const trimmed = text.trim();
	const content = truncate(trimmed || "(empty)", MRKDWN_MAX);
	const label = kind === "thinking" ? "Thinking" : "Response";
	const body = kind === "thinking" ? `_${escapeMrkdwn(content)}_` : escapeMrkdwn(content);

	return {
		blocks: [
			{
				type: "context",
				elements: [{ type: "mrkdwn", text: `*${label}*` }],
			},
			{
				type: "section",
				text: { type: "mrkdwn", text: body },
			},
		],
		fallbackText: `${label}: ${content}`,
	};
}

export function buildTaskCardStartPayload(toolName: string, label: string, argsText: string): SlackBlockPayload {
	const safeTool = escapeMrkdwn(toolName);
	const safeLabel = escapeMrkdwn(label);
	const args = argsText.trim();
	const blocks: SlackBlock[] = [
		{
			type: "section",
			text: { type: "mrkdwn", text: `:hourglass_flowing_sand: *${safeTool}* ${safeLabel ? `— ${safeLabel}` : ""}` },
		},
		{
			type: "context",
			elements: [{ type: "mrkdwn", text: "Status: `in_progress`" }],
		},
	];

	if (args) {
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: `*Args*\n${asCodeBlock(args, CODE_BLOCK_MAX)}` },
		});
	}

	return {
		blocks,
		fallbackText: `${toolName} [in_progress]${label ? ` ${label}` : ""}`,
	};
}

export function buildTaskCardResultPayload(
	toolName: string,
	label: string,
	status: TaskStatus,
	argsText: string,
	resultText: string,
	durationMs: number,
): SlackBlockPayload {
	const safeTool = escapeMrkdwn(toolName);
	const safeLabel = escapeMrkdwn(label);
	const args = argsText.trim();
	const durationSeconds = (durationMs / 1000).toFixed(1);
	const result = resultText.trim();
	const icon = status === "error" ? ":x:" : ":white_check_mark:";

	const blocks: SlackBlock[] = [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `${icon} *${safeTool}* ${safeLabel ? `— ${safeLabel}` : ""} (${durationSeconds}s)`,
			},
		},
		{
			type: "context",
			elements: [{ type: "mrkdwn", text: `Status: \`${status}\`` }],
		},
	];

	if (args) {
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: `*Args*\n${asCodeBlock(args, CODE_BLOCK_MAX)}` },
		});
	}

	if (result) {
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: `*Result*\n${asCodeBlock(result, CODE_BLOCK_MAX)}` },
		});
	}

	return {
		blocks,
		fallbackText: `${toolName} [${status}] ${truncate(result || "(no result)", 300)}`,
	};
}
