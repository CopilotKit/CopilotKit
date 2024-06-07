export function maxTokensForGroqModel(model: string): number {
  return maxTokensByModel[model] || DEFAULT_MAX_TOKENS;
}

const DEFAULT_MAX_TOKENS = 8192;

const maxTokensByModel: { [key: string]: number } = {
  // llama3
  "llama3-8b-8192": DEFAULT_MAX_TOKENS,
  "llama3-70b-8192": DEFAULT_MAX_TOKENS,
};

