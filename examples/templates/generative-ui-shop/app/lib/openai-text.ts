import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import type { OpenAICompatibleTextConfig } from "@tanstack/ai-openai/compatible";

type OpenAITextConfig = Omit<
  OpenAICompatibleTextConfig,
  "api" | "name" | "baseURL" | "apiKey"
> & {
  baseURL?: string;
  apiKey?: string;
};

/** Use Responses without the pinned SDK's closed model-name catalog. */
export function openaiText(model: string, config: OpenAITextConfig = {}) {
  return openaiCompatibleText(model, {
    ...config,
    api: "responses",
    name: "openai",
    baseURL:
      config.baseURL ??
      process.env.OPENAI_BASE_URL ??
      "https://api.openai.com/v1",
    apiKey:
      config.apiKey ??
      (process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || ""),
  });
}
