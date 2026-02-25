import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "./model-registry.js";

/**
 * 精确匹配模型
 * 支持 "provider/modelId" 或仅 "modelId" 格式
 */
export function findExactModelMatch(searchTerm: string, modelRegistry: ModelRegistry): Model<Api> | undefined {
	const term = searchTerm.trim().toLowerCase();
	if (!term) return undefined;

	let targetProvider: string | undefined;
	let targetModelId: string;

	if (term.includes("/")) {
		const parts = term.split("/", 2);
		targetProvider = parts[0]?.trim();
		targetModelId = parts[1]?.trim() ?? "";
	} else {
		targetModelId = term;
	}

	if (!targetModelId) return undefined;

	const models = modelRegistry.getAvailable();
	const exactMatches = models.filter((model) => {
		const idMatch = model.id.toLowerCase() === targetModelId;
		const providerMatch = !targetProvider || model.provider.toLowerCase() === targetProvider;
		return idMatch && providerMatch;
	});

	return exactMatches.length === 1 ? exactMatches[0] : undefined;
}

/**
 * 查找候选模型（用于错误提示）
 * 按相关性排序：model id 精确匹配 > model id 开头匹配 > model id 包含匹配 > provider 匹配
 */
export function findModelCandidates(
	searchTerm: string,
	modelRegistry: ModelRegistry,
	limit: number = 10,
): Model<Api>[] {
	const term = searchTerm.trim().toLowerCase();
	const models = modelRegistry.getAvailable();

	// 计算每个模型的相关性分数
	const scored = models
		.map((m) => {
			const modelId = m.id.toLowerCase();
			const provider = m.provider.toLowerCase();
			let score = 0;

			// Model id 匹配（优先级更高）
			if (modelId === term)
				score = 100; // 精确匹配
			else if (modelId.startsWith(term))
				score = 80; // 开头匹配
			else if (modelId.includes(term))
				score = 60; // 包含匹配
			// Provider 匹配（优先级较低）
			else if (provider === term)
				score = 40; // provider 精确匹配
			else if (provider.includes(term)) score = 20; // provider 包含匹配

			return { model: m, score };
		})
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score);

	return scored.slice(0, limit).map((item) => item.model);
}

/**
 * 格式化模型状态（用于 /model 无参数时的显示）
 */
export function formatModelStatus(currentModel: Model<Api> | undefined, availableModels: Model<Api>[]): string {
	const lines: string[] = [];

	if (currentModel) {
		lines.push(`Current model: ${currentModel.provider}/${currentModel.id}`);
	} else {
		lines.push("No model selected.");
	}

	lines.push(`\nAvailable models (${availableModels.length}):`);
	for (const model of availableModels) {
		const marker =
			currentModel && model.provider === currentModel.provider && model.id === currentModel.id ? " *" : "";
		lines.push(`  - ${model.provider}/${model.id}${marker}`);
	}

	return lines.join("\n");
}

/**
 * 格式化模型未找到错误（带候选列表）
 */
export function formatModelNotFound(searchTerm: string, candidates: Model<Api>[]): string {
	if (candidates.length === 0) {
		return `No model found matching "${searchTerm}". Use "/model" to see available models.`;
	}

	const candidateList = candidates.map((m) => `  - ${m.provider}/${m.id}`).join("\n");

	return `No exact match for "${searchTerm}". Did you mean:\n${candidateList}`;
}
