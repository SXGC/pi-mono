import type { Api, Model } from "@mariozechner/pi-ai";
import { isBuiltinCommand } from "./command-parser.js";
import { findExactModelMatch, findModelCandidates, formatModelNotFound, formatModelStatus } from "./model-matcher.js";
import type { ModelRegistry } from "./model-registry.js";

/**
 * 内建命令执行器的运行时能力。
 *
 * 不依赖具体 UI/传输层，通过注入能力实现复用。
 */
export interface BuiltinCommandRuntime {
	/** 可用模型与鉴权来源 */
	modelRegistry: ModelRegistry;
	/** 当前活跃模型 */
	currentModel: Model<Api> | undefined;
	/** 切换到新模型 */
	setModel(model: Model<Api>): Promise<void>;

	/** 创建新会话 */
	newSession(): Promise<boolean>;
	/** 是否存在流式输出 */
	isStreaming: boolean;
	/** 中断当前运行 */
	abort(): Promise<void>;

	/** 展示状态消息 */
	showStatus(message: string): void;
	/** 展示错误消息 */
	showError(message: string): void;
}

/**
 * 内建命令执行结果。
 */
export interface BuiltinCommandResult {
	/** 是否由内建分发器处理 */
	handled: boolean;
	/** 执行是否成功 */
	success?: boolean;
	/** 用户可见反馈 */
	message?: string;
	/** 错误信息 */
	error?: string;
}

/**
 * 尝试执行内建命令。
 *
 * @param name - 命令名称（不含 `/` 前缀）
 * @param args - 命令参数原文
 * @param runtime - 运行时能力注入
 * @returns 命令执行结果；若不是内建命令则 `handled=false`
 */
export async function tryBuiltinCommand(
	name: string,
	args: string,
	runtime: BuiltinCommandRuntime,
): Promise<BuiltinCommandResult> {
	const commandName = name.trim().toLowerCase();

	if (!commandName || !isBuiltinCommand(commandName)) {
		return { handled: false };
	}

	switch (commandName) {
		case "model":
			return handleModelCommand(args, runtime);
		case "new":
			return handleNewCommand(args, runtime);
		default:
			return { handled: false };
	}
}

/**
 * 处理 `/model` 命令。
 *
 * - 无参数：返回当前模型状态与提示信息
 * - 有参数：尝试精确匹配并切换模型
 */
async function handleModelCommand(args: string, runtime: BuiltinCommandRuntime): Promise<BuiltinCommandResult> {
	const searchTerm = args.trim();

	if (!searchTerm) {
		const availableModels = runtime.modelRegistry.getAvailable();
		return {
			handled: true,
			success: true,
			message: formatModelStatus(runtime.currentModel, availableModels),
		};
	}

	const model = findExactModelMatch(searchTerm, runtime.modelRegistry);
	if (!model) {
		const candidates = findModelCandidates(searchTerm, runtime.modelRegistry);
		return {
			handled: true,
			success: false,
			message: formatModelNotFound(searchTerm, candidates),
		};
	}

	try {
		await runtime.setModel(model);
		return {
			handled: true,
			success: true,
			message: `Switched model to ${model.provider}/${model.id}`,
		};
	} catch (error) {
		return {
			handled: true,
			success: false,
			error: toErrorMessage(error),
		};
	}
}

/**
 * 处理 `/new` 命令。
 *
 * `/new` 不接受参数；执行前若仍在流式输出会先中断。
 */
async function handleNewCommand(args: string, runtime: BuiltinCommandRuntime): Promise<BuiltinCommandResult> {
	if (args.trim()) {
		return {
			handled: true,
			success: false,
			message: "Usage: /new (no arguments)",
		};
	}

	try {
		if (runtime.isStreaming) {
			await runtime.abort();
		}

		const success = await runtime.newSession();
		if (success) {
			return {
				handled: true,
				success: true,
				message: "New session started",
			};
		}

		return {
			handled: true,
			success: false,
			message: "New session cancelled by extension",
		};
	} catch (error) {
		return {
			handled: true,
			success: false,
			error: toErrorMessage(error),
		};
	}
}

/**
 * 安全地提取错误文本。
 */
function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
