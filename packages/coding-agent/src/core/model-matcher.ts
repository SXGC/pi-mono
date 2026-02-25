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
 */
export function findModelCandidates(searchTerm: string, modelRegistry: ModelRegistry, limit: number = 5): Model<Api>[] {
	const term = searchTerm.trim().toLowerCase();
	const models = modelRegistry.getAvailable();

	// 模糊匹配: modelId 或 provider 包含搜索词
	return models
		.filter((m) => m.id.toLowerCase().includes(term) || m.provider.toLowerCase().includes(term))
		.slice(0, limit);
}

/**
 * 格式化模型状态（用于 /model 无参数时的显示）
 */
export function formatModelStatus(currentModel: Model<Api> | undefined, availableModels: Model<Api>[]): string {
	if (!currentModel) {
		return `No model selected. ${availableModels.length} models available.`;
	}
	return `Current model: ${currentModel.provider}/${currentModel.id}`;
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
