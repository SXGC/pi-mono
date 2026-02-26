import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import type { ImageContent } from "@mariozechner/pi-ai";
import {
	AgentSession,
	AuthStorage,
	type BuiltinCommandResult,
	type BuiltinCommandRuntime,
	convertToLlm,
	createExtensionRuntime,
	formatSkillsForPrompt,
	type LoadSkillsResult,
	loadSkills,
	loadSkillsFromDir,
	ModelRegistry,
	type ResourceLoader,
	SessionManager,
	type Skill,
	tryBuiltinCommand,
} from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { MomSettingsManager, syncLogToSessionManager } from "./context.js";
import * as log from "./log.js";
import { createExecutor, type SandboxConfig } from "./sandbox.js";
import type { ChannelInfo, SlackContext, UserInfo } from "./slack.js";
import { buildMarkdownPayload, buildTaskCardResultPayload, buildTaskCardStartPayload } from "./slack-blocks.js";
import type { ChannelStore } from "./store.js";
import { createMomTools, setUploadFunction } from "./tools/index.js";

const agentLog = log.createLogger("agent");

export interface PendingMessage {
	userName: string;
	text: string;
	attachments: { local: string }[];
	timestamp: number;
}

export interface AgentRunner {
	run(
		ctx: SlackContext,
		store: ChannelStore,
		pendingMessages?: PendingMessage[],
	): Promise<{ stopReason: string; errorMessage?: string }>;
	abort(): void;
	executeBuiltinCommand(name: string, args: string): Promise<BuiltinCommandResult>;
}

const IMAGE_MIME_TYPES: Record<string, string> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	gif: "image/gif",
	webp: "image/webp",
};

function getImageMimeType(filename: string): string | undefined {
	return IMAGE_MIME_TYPES[filename.toLowerCase().split(".").pop() || ""];
}

function getMemory(channelDir: string): string {
	const parts: string[] = [];

	// Read workspace-level memory (shared across all channels)
	const workspaceMemoryPath = join(channelDir, "..", "MEMORY.md");
	if (existsSync(workspaceMemoryPath)) {
		try {
			const content = readFileSync(workspaceMemoryPath, "utf-8").trim();
			if (content) {
				parts.push(`### Global Workspace Memory\n${content}`);
			}
		} catch (error) {
			agentLog.warning("Failed to read workspace memory", `${workspaceMemoryPath}: ${error}`);
		}
	}

	// Read channel-specific memory
	const channelMemoryPath = join(channelDir, "MEMORY.md");
	if (existsSync(channelMemoryPath)) {
		try {
			const content = readFileSync(channelMemoryPath, "utf-8").trim();
			if (content) {
				parts.push(`### Channel-Specific Memory\n${content}`);
			}
		} catch (error) {
			agentLog.warning("Failed to read channel memory", `${channelMemoryPath}: ${error}`);
		}
	}

	if (parts.length === 0) {
		return "(no working memory yet)";
	}

	return parts.join("\n\n");
}

function loadMomSkills(channelDir: string, workspacePath: string, sandboxConfig: SandboxConfig): LoadSkillsResult {
	const skillMap = new Map<string, Skill>();
	const diagnostics = [] as LoadSkillsResult["diagnostics"];

	// channelDir is the host path (e.g., /Users/.../data/C0A34FL8PMH)
	// hostWorkspacePath is the parent directory on host
	// workspacePath is the container path (e.g., /workspace)
	const hostWorkspacePath = join(channelDir, "..");

	// Helper to translate host paths to container paths
	const translatePath = (hostPath: string): string => {
		if (hostPath.startsWith(hostWorkspacePath)) {
			return workspacePath + hostPath.slice(hostWorkspacePath.length);
		}
		return hostPath;
	};

	const addSkills = (
		result: LoadSkillsResult,
		translateToWorkspacePath: boolean,
		disableModelInvocation: boolean = false,
	): void => {
		diagnostics.push(...result.diagnostics);

		for (const loadedSkill of result.skills) {
			const skill: Skill = {
				...loadedSkill,
				filePath: translateToWorkspacePath ? translatePath(loadedSkill.filePath) : loadedSkill.filePath,
				baseDir: translateToWorkspacePath ? translatePath(loadedSkill.baseDir) : loadedSkill.baseDir,
				disableModelInvocation: disableModelInvocation ? true : loadedSkill.disableModelInvocation,
			};

			skillMap.set(skill.name, skill);
		}
	};

	const builtinSkills = loadSkills({
		cwd: hostWorkspacePath,
		includeDefaults: false,
		includeBuiltin: true,
	});
	addSkills(builtinSkills, false, sandboxConfig.type === "docker");

	// Load workspace-level skills (global)
	const workspaceSkillsDir = join(hostWorkspacePath, "skills");
	addSkills(loadSkillsFromDir({ dir: workspaceSkillsDir, source: "workspace" }), true);

	// Load channel-specific skills (override workspace skills on collision)
	const channelSkillsDir = join(channelDir, "skills");
	addSkills(loadSkillsFromDir({ dir: channelSkillsDir, source: "channel" }), true);

	return { skills: Array.from(skillMap.values()), diagnostics };
}

function buildSystemPrompt(
	workspacePath: string,
	channelId: string,
	memory: string,
	sandboxConfig: SandboxConfig,
	channels: ChannelInfo[],
	users: UserInfo[],
	skills: Skill[],
): string {
	const channelPath = `${workspacePath}/${channelId}`;
	const isDocker = sandboxConfig.type === "docker";

	// Format channel mappings
	const channelMappings =
		channels.length > 0 ? channels.map((c) => `${c.id}\t#${c.name}`).join("\n") : "(no channels loaded)";

	// Format user mappings
	const userMappings =
		users.length > 0 ? users.map((u) => `${u.id}\t@${u.userName}\t${u.displayName}`).join("\n") : "(no users loaded)";

	const envDescription = isDocker
		? `You are running inside a Docker container (Alpine Linux).
- Bash working directory: / (use cd or absolute paths)
- Install tools with: apk add <package>
- Your changes persist across sessions`
		: `You are running directly on the host machine.
- Bash working directory: ${process.cwd()}
- Be careful with system modifications`;

	return `You are mom, a Slack bot assistant. Be concise. No emojis.

## Context
- For current date/time, use: date
- You have access to previous conversation context including tool results from prior turns.
- For older history beyond your context, search log.jsonl (contains user messages and your final responses, but not tool results).

## Slack Formatting (mrkdwn, NOT Markdown)
Bold: *text*, Italic: _text_, Code: \`code\`, Block: \`\`\`code\`\`\`, Links: <url|text>
Do NOT use **double asterisks** or [markdown](links).

## Slack IDs
Channels: ${channelMappings}

Users: ${userMappings}

When mentioning users, use <@username> format (e.g., <@mario>).

## Environment
${envDescription}

## Workspace Layout
${workspacePath}/
├── MEMORY.md                    # Global memory (all channels)
├── skills/                      # Global CLI tools you create
└── ${channelId}/                # This channel
    ├── MEMORY.md                # Channel-specific memory
    ├── log.jsonl                # Message history (no tool results)
    ├── attachments/             # User-shared files
    ├── scratch/                 # Your working directory
    └── skills/                  # Channel-specific tools

## Skills (Custom CLI Tools)
You can create reusable CLI tools for recurring tasks (email, APIs, data processing, etc.).

### Creating Skills
Store in \`${workspacePath}/skills/<name>/\` (global) or \`${channelPath}/skills/<name>/\` (channel-specific).
Each skill directory needs a \`SKILL.md\` with YAML frontmatter:

\`\`\`markdown
---
name: skill-name
description: Short description of what this skill does
---

# Skill Name

Usage instructions, examples, etc.
Scripts are in: {baseDir}/
\`\`\`

\`name\` and \`description\` are required. Use \`{baseDir}\` as placeholder for the skill's directory path.

### Available Skills
${skills.length > 0 ? formatSkillsForPrompt(skills) : "(no skills installed yet)"}

## Events
You can schedule events that wake you up at specific times or when external things happen. Events are JSON files in \`${workspacePath}/events/\`.

### Event Types

**Immediate** - Triggers as soon as harness sees the file. Use in scripts/webhooks to signal external events.
\`\`\`json
{"type": "immediate", "channelId": "${channelId}", "text": "New GitHub issue opened"}
\`\`\`

**One-shot** - Triggers once at a specific time. Use for reminders.
\`\`\`json
{"type": "one-shot", "channelId": "${channelId}", "text": "Remind Mario about dentist", "at": "2025-12-15T09:00:00+01:00"}
\`\`\`

**Periodic** - Triggers on a cron schedule. Use for recurring tasks.
\`\`\`json
{"type": "periodic", "channelId": "${channelId}", "text": "Check inbox and summarize", "schedule": "0 9 * * 1-5", "timezone": "${Intl.DateTimeFormat().resolvedOptions().timeZone}"}
\`\`\`

### Cron Format
\`minute hour day-of-month month day-of-week\`
- \`0 9 * * *\` = daily at 9:00
- \`0 9 * * 1-5\` = weekdays at 9:00
- \`30 14 * * 1\` = Mondays at 14:30
- \`0 0 1 * *\` = first of each month at midnight

### Timezones
All \`at\` timestamps must include offset (e.g., \`+01:00\`). Periodic events use IANA timezone names. The harness runs in ${Intl.DateTimeFormat().resolvedOptions().timeZone}. When users mention times without timezone, assume ${Intl.DateTimeFormat().resolvedOptions().timeZone}.

### Creating Events
Use unique filenames to avoid overwriting existing events. Include a timestamp or random suffix:
\`\`\`bash
cat > ${workspacePath}/events/dentist-reminder-$(date +%s).json << 'EOF'
{"type": "one-shot", "channelId": "${channelId}", "text": "Dentist tomorrow", "at": "2025-12-14T09:00:00+01:00"}
EOF
\`\`\`
Or check if file exists first before creating.

### Managing Events
- List: \`ls ${workspacePath}/events/\`
- View: \`cat ${workspacePath}/events/foo.json\`
- Delete/cancel: \`rm ${workspacePath}/events/foo.json\`

### When Events Trigger
You receive a message like:
\`\`\`
[EVENT:dentist-reminder.json:one-shot:2025-12-14T09:00:00+01:00] Dentist tomorrow
\`\`\`
Immediate and one-shot events auto-delete after triggering. Periodic events persist until you delete them.

### Silent Completion
For periodic events where there's nothing to report, respond with just \`[SILENT]\` (no other text). This deletes the status message and posts nothing to Slack. Use this to avoid spamming the channel when periodic checks find nothing actionable.

### Debouncing
When writing programs that create immediate events (email watchers, webhook handlers, etc.), always debounce. If 50 emails arrive in a minute, don't create 50 immediate events. Instead collect events over a window and create ONE immediate event summarizing what happened, or just signal "new activity, check inbox" rather than per-item events. Or simpler: use a periodic event to check for new items every N minutes instead of immediate events.

### Limits
Maximum 5 events can be queued. Don't create excessive immediate or periodic events.

## Memory
Write to MEMORY.md files to persist context across conversations.
- Global (${workspacePath}/MEMORY.md): skills, preferences, project info
- Channel (${channelPath}/MEMORY.md): channel-specific decisions, ongoing work
Update when you learn something important or when asked to remember something.

### Current Memory
${memory}

## System Configuration Log
Maintain ${workspacePath}/SYSTEM.md to log all environment modifications:
- Installed packages (apk add, npm install, pip install)
- Environment variables set
- Config files modified (~/.gitconfig, cron jobs, etc.)
- Skill dependencies installed

Update this file whenever you modify the environment. On fresh container, read it first to restore your setup.

## Log Queries (for older history)
Format: \`{"date":"...","ts":"...","user":"...","userName":"...","text":"...","isBot":false}\`
The log contains user messages and your final responses (not tool calls/results).
${isDocker ? "Install jq: apk add jq" : ""}

\`\`\`bash
# Recent messages
tail -30 log.jsonl | jq -c '{date: .date[0:19], user: (.userName // .user), text}'

# Search for specific topic
grep -i "topic" log.jsonl | jq -c '{date: .date[0:19], user: (.userName // .user), text}'

# Messages from specific user
grep '"userName":"mario"' log.jsonl | tail -20 | jq -c '{date: .date[0:19], text}'
\`\`\`

## Tools
- bash: Run shell commands (primary tool). Install packages as needed.
- read: Read files
- write: Create/overwrite files
- edit: Surgical file edits
- attach: Share files to Slack

Each tool requires a "label" parameter (shown to user).
`;
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.substring(0, maxLen - 3)}...`;
}

function extractToolResultText(result: unknown): string {
	if (typeof result === "string") {
		return result;
	}

	if (
		result &&
		typeof result === "object" &&
		"content" in result &&
		Array.isArray((result as { content: unknown }).content)
	) {
		const content = (result as { content: Array<{ type: string; text?: string }> }).content;
		const textParts: string[] = [];
		for (const part of content) {
			if (part.type === "text" && part.text) {
				textParts.push(part.text);
			}
		}
		if (textParts.length > 0) {
			return textParts.join("\n");
		}
	}

	return JSON.stringify(result);
}

function formatToolArgsForSlack(_toolName: string, args: Record<string, unknown>): string {
	const lines: string[] = [];

	for (const [key, value] of Object.entries(args)) {
		if (key === "label") continue;

		if (key === "path" && typeof value === "string") {
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			if (offset !== undefined && limit !== undefined) {
				lines.push(`${value}:${offset}-${offset + limit}`);
			} else {
				lines.push(value);
			}
			continue;
		}

		if (key === "offset" || key === "limit") continue;

		if (typeof value === "string") {
			lines.push(value);
		} else {
			lines.push(JSON.stringify(value));
		}
	}

	return lines.join("\n");
}

// Cache runners per channel
const channelRunners = new Map<string, AgentRunner>();

/**
 * Get or create an AgentRunner for a channel.
 * Runners are cached - one per channel, persistent across messages.
 */
export function getOrCreateRunner(sandboxConfig: SandboxConfig, channelId: string, channelDir: string): AgentRunner {
	const existing = channelRunners.get(channelId);
	if (existing) return existing;

	const runner = createRunner(sandboxConfig, channelId, channelDir);
	channelRunners.set(channelId, runner);
	return runner;
}

/**
 * Create a new AgentRunner for a channel.
 * Sets up the session and subscribes to events once.
 */
function createRunner(sandboxConfig: SandboxConfig, channelId: string, channelDir: string): AgentRunner {
	const executor = createExecutor(sandboxConfig);
	const workspacePath = executor.getWorkspacePath(channelDir.replace(`/${channelId}`, ""));

	// Create tools
	const tools = createMomTools(executor);

	// Initial system prompt (will be updated each run with fresh memory/channels/users/skills)
	const memory = getMemory(channelDir);
	const initialSkillLoadResult = loadMomSkills(channelDir, workspacePath, sandboxConfig);
	let currentSkills = initialSkillLoadResult.skills;
	let currentSkillDiagnostics = initialSkillLoadResult.diagnostics;
	let currentSystemPrompt = buildSystemPrompt(workspacePath, channelId, memory, sandboxConfig, [], [], currentSkills);

	// Create session manager and settings manager
	// Use a fixed context.jsonl file per channel (not timestamped like coding-agent)
	const contextFile = join(channelDir, "context.jsonl");
	const sessionManager = SessionManager.open(contextFile, channelDir);
	const settingsManager = new MomSettingsManager(join(channelDir, ".."));

	// Create AuthStorage and ModelRegistry
	// Auth stored outside workspace so agent can't access it
	const authStorage = AuthStorage.create(join(homedir(), ".pi", "mom", "auth.json"));
	const modelRegistry = new ModelRegistry(authStorage);
	const loadedSession = sessionManager.buildSessionContext();
	const availableModels = modelRegistry.getAvailable();
	const configuredDefaultProvider = settingsManager.getDefaultProvider();
	const configuredDefaultModel = settingsManager.getDefaultModel();
	const restoredModel = loadedSession.model
		? availableModels.find(
				(m) => m.provider === loadedSession.model?.provider && m.id === loadedSession.model?.modelId,
			)
		: undefined;
	const configuredModel =
		configuredDefaultProvider && configuredDefaultModel
			? availableModels.find((m) => m.provider === configuredDefaultProvider && m.id === configuredDefaultModel)
			: undefined;
	const initialModel = restoredModel ?? configuredModel ?? availableModels[0];
	const initialModelSource = restoredModel
		? "restored-session"
		: configuredModel
			? "workspace-default"
			: "first-available";
	const initialThinkingLevel = initialModel?.reasoning ? settingsManager.getDefaultThinkingLevel() : "off";

	if (configuredDefaultProvider && configuredDefaultModel) {
		agentLog.info(`[${channelId}] Startup default model: ${configuredDefaultProvider}/${configuredDefaultModel}`);
	} else {
		agentLog.info(`[${channelId}] Startup default model: (not configured)`);
	}

	if (initialModel) {
		agentLog.info(
			`[${channelId}] Initial session model: ${initialModel.provider}/${initialModel.id} (${initialModelSource})`,
		);
	} else {
		agentLog.warning(`[${channelId}] Initial session model: (none available)`);
	}

	// Create agent
	let agent: Agent;
	agent = new Agent({
		initialState: {
			systemPrompt: currentSystemPrompt,
			model: initialModel,
			thinkingLevel: initialThinkingLevel,
			tools,
		},
		convertToLlm,
		sessionId: sessionManager.getSessionId(),
		getApiKey: async (provider) => {
			const resolvedProvider = provider || agent.state.model?.provider;
			if (!resolvedProvider) {
				throw new Error("No model selected");
			}
			const key = await modelRegistry.getApiKeyForProvider(resolvedProvider);
			if (!key) {
				const currentModel = agent.state.model;
				const isOAuth = currentModel ? modelRegistry.isUsingOAuth(currentModel) : false;
				if (isOAuth) {
					throw new Error(
						`Authentication failed for "${resolvedProvider}". ` +
							"Credentials may have expired or network is unavailable. " +
							`Run '/login ${resolvedProvider}' to re-authenticate.`,
					);
				}
				throw new Error(
					`No API key found for "${resolvedProvider}". ` +
						`Set an API key environment variable or run '/login ${resolvedProvider}'.`,
				);
			}
			return key;
		},
	});

	// Load existing messages
	if (loadedSession.messages.length > 0) {
		agent.replaceMessages(loadedSession.messages);
		agentLog.info(`[${channelId}] Loaded ${loadedSession.messages.length} messages from context.jsonl`);
	}

	const resourceLoader: ResourceLoader = {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
		getSkills: () => ({ skills: currentSkills, diagnostics: currentSkillDiagnostics }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => currentSystemPrompt,
		getAppendSystemPrompt: () => [],
		getPathMetadata: () => new Map(),
		extendResources: () => {},
		reload: async () => {},
	};

	const baseToolsOverride = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

	// Create AgentSession wrapper
	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager: settingsManager as any,
		cwd: process.cwd(),
		modelRegistry,
		resourceLoader,
		baseToolsOverride,
	});

	// Mutable per-run state - event handler references this
	const runState = {
		ctx: null as SlackContext | null,
		logCtx: null as { channelId: string; userName?: string; channelName?: string } | null,
		queue: null as {
			enqueue(fn: () => Promise<void>, errorContext: string): void;
			enqueueMessage(text: string, target: "main" | "thread", errorContext: string, doLog?: boolean): void;
		} | null,
		pendingTools: new Map<
			string,
			{
				toolName: string;
				args: Record<string, unknown>;
				label: string;
				startTime: number;
				messageTs?: string;
			}
		>(),
		totalUsage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		errorMessage: undefined as string | undefined,
	};

	// Subscribe to events ONCE
	session.subscribe(async (event) => {
		// Skip if no active run
		if (!runState.ctx || !runState.logCtx || !runState.queue) return;

		const { ctx, logCtx, queue, pendingTools } = runState;

		if (event.type === "tool_execution_start") {
			const agentEvent = event as AgentEvent & { type: "tool_execution_start" };
			const args = (agentEvent.args ?? {}) as Record<string, unknown>;
			const label = typeof args.label === "string" ? args.label : agentEvent.toolName;
			const argsFormatted = formatToolArgsForSlack(agentEvent.toolName, args);
			const pendingTool = {
				toolName: agentEvent.toolName,
				args,
				label,
				startTime: Date.now(),
				messageTs: undefined as string | undefined,
			};

			pendingTools.set(agentEvent.toolCallId, pendingTool);

			log.logToolStart(logCtx, agentEvent.toolName, label, args);
			const payload = buildTaskCardStartPayload(agentEvent.toolName, label, argsFormatted);
			queue.enqueue(async () => {
				const ts = await ctx.respondBlocksInThread(payload.blocks, payload.fallbackText);
				if (!ts) return;
				pendingTool.messageTs = ts;
			}, "tool start block");
		} else if (event.type === "tool_execution_end") {
			const agentEvent = event as AgentEvent & { type: "tool_execution_end" };
			const resultStr = extractToolResultText(agentEvent.result);
			const pending = pendingTools.get(agentEvent.toolCallId);
			pendingTools.delete(agentEvent.toolCallId);

			const durationMs = pending ? Date.now() - pending.startTime : 0;

			if (agentEvent.isError) {
				log.logToolError(logCtx, agentEvent.toolName, durationMs, resultStr);
			} else {
				log.logToolSuccess(logCtx, agentEvent.toolName, durationMs, resultStr);
			}

			const argsFormatted = pending ? formatToolArgsForSlack(agentEvent.toolName, pending.args) : "(args not found)";
			const label = pending?.label || agentEvent.toolName;
			const status = agentEvent.isError ? "error" : "complete";
			const payload = buildTaskCardResultPayload(
				agentEvent.toolName,
				label,
				status,
				argsFormatted,
				resultStr,
				durationMs,
			);

			queue.enqueue(async () => {
				if (pending?.messageTs) {
					await ctx.updateThreadBlocks(pending.messageTs, payload.blocks, payload.fallbackText);
					return;
				}
				await ctx.respondBlocksInThread(payload.blocks, payload.fallbackText);
			}, "tool result block");

			if (agentEvent.isError) {
				queue.enqueue(() => ctx.respond(`_Error: ${truncate(resultStr, 200)}_`, false), "tool error");
			}
		} else if (event.type === "message_start") {
			const agentEvent = event as AgentEvent & { type: "message_start" };
			if (agentEvent.message.role === "assistant") {
				log.logResponseStart(logCtx);
			}
		} else if (event.type === "message_end") {
			const agentEvent = event as AgentEvent & { type: "message_end" };
			if (agentEvent.message.role === "assistant") {
				const assistantMsg = agentEvent.message as any;

				if (assistantMsg.stopReason) {
					runState.stopReason = assistantMsg.stopReason;
				}
				if (assistantMsg.errorMessage) {
					runState.errorMessage = assistantMsg.errorMessage;
				}

				if (assistantMsg.usage) {
					runState.totalUsage.input += assistantMsg.usage.input;
					runState.totalUsage.output += assistantMsg.usage.output;
					runState.totalUsage.cacheRead += assistantMsg.usage.cacheRead;
					runState.totalUsage.cacheWrite += assistantMsg.usage.cacheWrite;
					runState.totalUsage.cost.input += assistantMsg.usage.cost.input;
					runState.totalUsage.cost.output += assistantMsg.usage.cost.output;
					runState.totalUsage.cost.cacheRead += assistantMsg.usage.cost.cacheRead;
					runState.totalUsage.cost.cacheWrite += assistantMsg.usage.cost.cacheWrite;
					runState.totalUsage.cost.total += assistantMsg.usage.cost.total;
				}

				const content = agentEvent.message.content;
				const thinkingParts: string[] = [];
				const textParts: string[] = [];
				for (const part of content) {
					if (part.type === "thinking") {
						thinkingParts.push((part as any).thinking);
					} else if (part.type === "text") {
						textParts.push((part as any).text);
					}
				}

				const text = textParts.join("\n");

				for (const thinking of thinkingParts) {
					log.logThinking(logCtx, thinking);
					const payload = buildMarkdownPayload(thinking, "thinking");
					queue.enqueue(
						() => ctx.respondBlocksInThread(payload.blocks, payload.fallbackText).then(() => undefined),
						"thinking thread block",
					);
				}

				if (text.trim()) {
					log.logResponse(logCtx, text);
					const payload = buildMarkdownPayload(text, "text");
					queue.enqueue(
						() => ctx.respondBlocksInThread(payload.blocks, payload.fallbackText).then(() => undefined),
						"response thread block",
					);
				}
			}
		} else if (event.type === "auto_compaction_start") {
			agentLog.info(`Auto-compaction started (reason: ${(event as any).reason})`);
			queue.enqueue(() => ctx.respond("_Compacting context..._", false), "compaction start");
		} else if (event.type === "auto_compaction_end") {
			const compEvent = event as any;
			if (compEvent.result) {
				agentLog.info(`Auto-compaction complete: ${compEvent.result.tokensBefore} tokens compacted`);
			} else if (compEvent.aborted) {
				agentLog.info("Auto-compaction aborted");
			}
		} else if (event.type === "auto_retry_start") {
			const retryEvent = event as any;
			agentLog.warning(`Retrying (${retryEvent.attempt}/${retryEvent.maxAttempts})`, retryEvent.errorMessage);
			queue.enqueue(
				() => ctx.respond(`_Retrying (${retryEvent.attempt}/${retryEvent.maxAttempts})..._`, false),
				"retry",
			);
		}
	});

	// Slack message limit
	const SLACK_MAX_LENGTH = 40000;
	const splitForSlack = (text: string): string[] => {
		if (text.length <= SLACK_MAX_LENGTH) return [text];
		const parts: string[] = [];
		let remaining = text;
		let partNum = 1;
		while (remaining.length > 0) {
			const chunk = remaining.substring(0, SLACK_MAX_LENGTH - 50);
			remaining = remaining.substring(SLACK_MAX_LENGTH - 50);
			const suffix = remaining.length > 0 ? `\n_(continued ${partNum}...)_` : "";
			parts.push(chunk + suffix);
			partNum++;
		}
		return parts;
	};

	const builtinRuntime: BuiltinCommandRuntime = {
		get modelRegistry() {
			return modelRegistry;
		},
		get currentModel() {
			return agent.state.model;
		},
		async setModel(model) {
			const apiKey = await modelRegistry.getApiKey(model);
			if (!apiKey) {
				throw new Error(`No API key for ${model.provider}/${model.id}`);
			}
			agent.setModel(model);
			sessionManager.appendModelChange(model.provider, model.id);
			settingsManager.setDefaultModelAndProvider(model.provider, model.id);
			agentLog.info(`[${channelId}] Model changed to ${model.provider}/${model.id}`);
		},
		async newSession() {
			await resetSession();
			return true;
		},
		get isStreaming() {
			return agent.state.isStreaming;
		},
		async abort() {
			agent.abort();
			await agent.waitForIdle();
		},
		showStatus(message) {
			agentLog.info(`[${channelId}] Status: ${message}`);
		},
		showError(message) {
			agentLog.warning(`[${channelId}] Error: ${message}`);
		},
	};

	async function resetSession(): Promise<void> {
		if (agent.state.isStreaming) {
			agent.abort();
			await agent.waitForIdle();
		}

		const archiveDir = join(channelDir, "archive");
		if (!existsSync(archiveDir)) {
			mkdirSync(archiveDir, { recursive: true });
		}

		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const contextFile = join(channelDir, "context.jsonl");
		const logFile = join(channelDir, "log.jsonl");

		if (existsSync(contextFile)) {
			renameSync(contextFile, join(archiveDir, `context.${timestamp}.jsonl`));
		}
		if (existsSync(logFile)) {
			renameSync(logFile, join(archiveDir, `log.${timestamp}.jsonl`));
		}

		writeFileSync(contextFile, "");
		writeFileSync(logFile, "");

		sessionManager.setSessionFile(contextFile);
		agent.replaceMessages([]);

		agentLog.info(`[${channelId}] Session reset, archived to ${timestamp}`);
	}

	return {
		async run(
			ctx: SlackContext,
			_store: ChannelStore,
			_pendingMessages?: PendingMessage[],
		): Promise<{ stopReason: string; errorMessage?: string }> {
			// Ensure channel directory exists
			await mkdir(channelDir, { recursive: true });

			// Sync messages from log.jsonl that arrived while we were offline or busy
			// Exclude the current message (it will be added via prompt())
			const syncedCount = syncLogToSessionManager(sessionManager, channelDir, ctx.message.ts);
			if (syncedCount > 0) {
				agentLog.info(`[${channelId}] Synced ${syncedCount} messages from log.jsonl`);
			}

			// Reload messages from context.jsonl
			// This picks up any messages synced above
			const reloadedSession = sessionManager.buildSessionContext();
			if (reloadedSession.messages.length > 0) {
				agent.replaceMessages(reloadedSession.messages);
				agentLog.info(`[${channelId}] Reloaded ${reloadedSession.messages.length} messages from context`);
			}

			// Update system prompt with fresh memory, channel/user info, and skills
			const memory = getMemory(channelDir);
			const skillLoadResult = loadMomSkills(channelDir, workspacePath, sandboxConfig);
			const skills = skillLoadResult.skills;
			currentSkills = skills;
			currentSkillDiagnostics = skillLoadResult.diagnostics;
			const systemPrompt = buildSystemPrompt(
				workspacePath,
				channelId,
				memory,
				sandboxConfig,
				ctx.channels,
				ctx.users,
				skills,
			);
			currentSystemPrompt = systemPrompt;
			session.agent.setSystemPrompt(systemPrompt);

			// Set up file upload function
			setUploadFunction(async (filePath: string, title?: string) => {
				const hostPath = translateToHostPath(filePath, channelDir, workspacePath, channelId);
				await ctx.uploadFile(hostPath, title);
			});

			// Reset per-run state
			runState.ctx = ctx;
			runState.logCtx = {
				channelId: ctx.message.channel,
				userName: ctx.message.userName,
				channelName: ctx.channelName,
			};
			runState.pendingTools.clear();
			runState.totalUsage = {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			};
			runState.stopReason = "stop";
			runState.errorMessage = undefined;

			// Create queue for this run
			let queueChain = Promise.resolve();
			runState.queue = {
				enqueue(fn: () => Promise<void>, errorContext: string): void {
					queueChain = queueChain.then(async () => {
						try {
							await fn();
						} catch (err) {
							const errMsg = err instanceof Error ? err.message : String(err);
							agentLog.warning(`Slack API error (${errorContext})`, errMsg);
							try {
								await ctx.respondInThread(`_Error: ${errMsg}_`);
							} catch {
								// Ignore
							}
						}
					});
				},
				enqueueMessage(text: string, target: "main" | "thread", errorContext: string, doLog = true): void {
					const parts = splitForSlack(text);
					for (const part of parts) {
						this.enqueue(
							() => (target === "main" ? ctx.respond(part, doLog) : ctx.respondInThread(part)),
							errorContext,
						);
					}
				},
			};

			// Log context info
			agentLog.info(`Context sizes - system: ${systemPrompt.length} chars, memory: ${memory.length} chars`);
			agentLog.info(`Channels: ${ctx.channels.length}, Users: ${ctx.users.length}`);
			const currentModel = session.model;
			if (currentModel) {
				agentLog.info(`[${channelId}] Current session model: ${currentModel.provider}/${currentModel.id}`);
			} else {
				agentLog.warning(`[${channelId}] Current session model: (none)`);
			}

			// Build user message with timestamp and username prefix
			// Format: "[YYYY-MM-DD HH:MM:SS+HH:MM] [username]: message" so LLM knows when and who
			const now = new Date();
			const pad = (n: number) => n.toString().padStart(2, "0");
			const offset = -now.getTimezoneOffset();
			const offsetSign = offset >= 0 ? "+" : "-";
			const offsetHours = pad(Math.floor(Math.abs(offset) / 60));
			const offsetMins = pad(Math.abs(offset) % 60);
			const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${offsetSign}${offsetHours}:${offsetMins}`;
			let userMessage = `[${timestamp}] [${ctx.message.userName || "unknown"}]: ${ctx.message.text}`;

			const imageAttachments: ImageContent[] = [];
			const nonImagePaths: string[] = [];

			for (const a of ctx.message.attachments || []) {
				const fullPath = `${workspacePath}/${a.local}`;
				const mimeType = getImageMimeType(a.local);

				if (mimeType && existsSync(fullPath)) {
					try {
						imageAttachments.push({
							type: "image",
							mimeType,
							data: readFileSync(fullPath).toString("base64"),
						});
					} catch {
						nonImagePaths.push(fullPath);
					}
				} else {
					nonImagePaths.push(fullPath);
				}
			}

			if (nonImagePaths.length > 0) {
				userMessage += `\n\n<slack_attachments>\n${nonImagePaths.join("\n")}\n</slack_attachments>`;
			}

			// Debug: write context to last_prompt.jsonl
			const debugContext = {
				systemPrompt,
				messages: session.messages,
				newUserMessage: userMessage,
				imageAttachmentCount: imageAttachments.length,
			};
			await writeFile(join(channelDir, "last_prompt.jsonl"), JSON.stringify(debugContext, null, 2));

			await session.prompt(userMessage, imageAttachments.length > 0 ? { images: imageAttachments } : undefined);

			// Wait for queued messages
			await queueChain;

			// Handle error case - update main message and post error to thread
			if (runState.stopReason === "error" && runState.errorMessage) {
				try {
					await ctx.replaceMessage("_Sorry, something went wrong_");
					await ctx.respondInThread(`_Error: ${runState.errorMessage}_`);
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					agentLog.warning("Failed to post error message", errMsg);
				}
			} else {
				// Final message update
				const messages = session.messages;
				const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
				const finalText =
					lastAssistant?.content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map((c) => c.text)
						.join("\n") || "";

				// Check for [SILENT] marker - delete message and thread instead of posting
				if (finalText.trim() === "[SILENT]" || finalText.trim().startsWith("[SILENT]")) {
					try {
						await ctx.deleteMessage();
						agentLog.info("Silent response - deleted message and thread");
					} catch (err) {
						const errMsg = err instanceof Error ? err.message : String(err);
						agentLog.warning("Failed to delete message for silent response", errMsg);
					}
				} else if (finalText.trim()) {
					try {
						const mainText =
							finalText.length > SLACK_MAX_LENGTH
								? `${finalText.substring(0, SLACK_MAX_LENGTH - 50)}\n\n_(see thread for full response)_`
								: finalText;
						await ctx.replaceMessage(mainText);
					} catch (err) {
						const errMsg = err instanceof Error ? err.message : String(err);
						agentLog.warning("Failed to replace message with final text", errMsg);
					}
				}
			}

			// Log usage summary with context info
			if (runState.totalUsage.cost.total > 0) {
				// Get last non-aborted assistant message for context calculation
				const messages = session.messages;
				const lastAssistantMessage = messages
					.slice()
					.reverse()
					.find((m) => m.role === "assistant" && (m as any).stopReason !== "aborted") as any;

				const contextTokens = lastAssistantMessage
					? lastAssistantMessage.usage.input +
						lastAssistantMessage.usage.output +
						lastAssistantMessage.usage.cacheRead +
						lastAssistantMessage.usage.cacheWrite
					: 0;
				const contextWindow = session.model?.contextWindow || 200000;

				const summary = log.logUsageSummary(
					runState.logCtx!,
					runState.totalUsage,
					contextTokens,
					contextWindow,
					session.model || undefined,
				);
				runState.queue.enqueue(() => ctx.respondInThread(summary), "usage summary");
				await queueChain;
			}

			// Clear run state
			runState.ctx = null;
			runState.logCtx = null;
			runState.queue = null;

			return { stopReason: runState.stopReason, errorMessage: runState.errorMessage };
		},

		abort(): void {
			session.abort();
		},

		async executeBuiltinCommand(name: string, args: string): Promise<BuiltinCommandResult> {
			return tryBuiltinCommand(name, args, builtinRuntime);
		},
	};
}

/**
 * Translate container path back to host path for file operations
 */
function translateToHostPath(
	containerPath: string,
	channelDir: string,
	workspacePath: string,
	channelId: string,
): string {
	if (workspacePath === "/workspace") {
		const prefix = `/workspace/${channelId}/`;
		if (containerPath.startsWith(prefix)) {
			return join(channelDir, containerPath.slice(prefix.length));
		}
		if (containerPath.startsWith("/workspace/")) {
			return join(channelDir, "..", containerPath.slice("/workspace/".length));
		}
	}
	return containerPath;
}
