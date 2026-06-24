import { ChatOpenAI, ChatOpenAICompletions } from "@langchain/openai";
import type { ChatOpenAIFields } from "@langchain/openai";

const openAIBaseUrl = process.env.OPENAI_BASE_URL;
const openAIApiKey = process.env.OPENAI_API_KEY;

const openAIMaxTokensParsed = Number.parseInt(
  process.env.OPENAI_MAX_TOKENS || "1024",
  10,
);
const maxTokens = Number.isFinite(openAIMaxTokensParsed)
  ? openAIMaxTokensParsed
  : 1024;

export function createConfiguredChatOpenAI(fields: ChatOpenAIFields = {}) {
  const model = fields.model || process.env.OPENAI_MODEL;
  if (!model) {
    throw new Error(
      "OPENAI_MODEL is required. Set the OPENAI_MODEL environment variable or pass model in fields.",
    );
  }

  const effectiveApiKey = fields.apiKey ?? openAIApiKey;
  if (!effectiveApiKey) {
    throw new Error(
      "OPENAI_API_KEY is required. Set the OPENAI_API_KEY environment variable or pass apiKey in fields.",
    );
  }

  const modelFields: ChatOpenAIFields = {
    ...fields,
    model,
    maxTokens: fields.maxTokens ?? maxTokens,
    apiKey: effectiveApiKey,
    configuration: openAIBaseUrl
      ? { ...fields.configuration, baseURL: openAIBaseUrl }
      : fields.configuration,
  };

  if (openAIBaseUrl || fields.configuration?.baseURL) {
    return new ChatOpenAICompletions(modelFields);
  }
  return new ChatOpenAI(modelFields);
}
