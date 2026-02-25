import { BUILTIN_SLASH_COMMANDS } from "./slash-commands.js";

/**
 * 解析斜杠命令
 * @param text - 用户输入的文本
 * @returns 命令名称和参数，如果输入不是以 / 开头则返回 null
 */
export function parseSlashCommand(text: string): { name: string; args: string } | null {
	if (!text.startsWith("/")) return null;

	const trimmed = text.trim();
	const spaceIndex = trimmed.indexOf(" ");

	const name = (spaceIndex === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIndex)).trim().toLowerCase();
	const args = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1);

	if (!name) return null;
	return { name, args };
}

/**
 * 检查是否是内建命令
 * @param name - 命令名称（不含 / 前缀）
 * @returns 如果是内建命令返回 true，否则返回 false
 */
export function isBuiltinCommand(name: string): boolean {
	return BUILTIN_SLASH_COMMANDS.some((cmd) => cmd.name === name);
}
