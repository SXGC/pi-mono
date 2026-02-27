import type { MarkdownBlock, RichTextContent, SlackBlock, TaskCardBlock } from "./slack.js";

export interface SlackBlockPayload {
	blocks: SlackBlock[];
	fallbackText: string;
}

type MarkdownKind = "thinking" | "text";
type TaskStatus = "in_progress" | "complete" | "error";

const MARKDOWN_MAX = 10000; // Per block, total 12000 for all markdown blocks
const CODE_MAX = 8000;

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max - 3)}...`;
}

// Helper to create a rich_text block with preformatted (code block) content
function richTextPreformatted(text: string): RichTextContent {
	return {
		type: "rich_text",
		elements: [
			{
				type: "rich_text_preformatted",
				elements: [{ type: "text", text }],
			},
		],
	};
}

// Helper to create a rich_text block with quote content
function richTextQuote(text: string): RichTextContent {
	return {
		type: "rich_text",
		elements: [
			{
				type: "rich_text_quote",
				elements: [{ type: "text", text }],
			},
		],
	};
}

// Generate a unique task ID
function generateTaskId(): string {
	return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildMarkdownPayload(text: string, kind: MarkdownKind): SlackBlockPayload {
	const trimmed = text.trim();
	const content = truncate(trimmed || "(empty)", MARKDOWN_MAX);

	if (kind === "thinking") {
		// Use rich_text_quote for thinking content
		const block: RichTextContent = richTextQuote(content);
		return {
			blocks: [block],
			fallbackText: `Thinking: ${content}`,
		};
	} else {
		// Use markdown block for regular text
		const block: MarkdownBlock = {
			type: "markdown",
			text: content,
		};
		return {
			blocks: [block],
			fallbackText: content,
		};
	}
}

export function buildTaskCardStartPayload(toolName: string, label: string, argsText: string): SlackBlockPayload {
	const title = label ? `${toolName} — ${label}` : toolName;
	const args = argsText.trim();

	const block: TaskCardBlock = {
		type: "task_card",
		task_id: generateTaskId(),
		title,
		status: "in_progress",
	};

	if (args) {
		block.details = richTextPreformatted(truncate(args, CODE_MAX));
	}

	return {
		blocks: [block],
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
	const durationSeconds = (durationMs / 1000).toFixed(1);
	const title = label ? `${toolName} — ${label} (${durationSeconds}s)` : `${toolName} (${durationSeconds}s)`;
	const args = argsText.trim();
	const result = resultText.trim();

	const block: TaskCardBlock = {
		type: "task_card",
		task_id: generateTaskId(),
		title,
		status,
	};

	if (args) {
		block.details = richTextPreformatted(truncate(args, CODE_MAX));
	}

	if (result) {
		block.output = richTextPreformatted(truncate(result, CODE_MAX));
	}

	return {
		blocks: [block],
		fallbackText: `${toolName} [${status}] ${truncate(result || "(no result)", 300)}`,
	};
}
