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

export async function invokeConfiguredJsonChat(input: {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}): Promise<string> {
  const baseUrl = openAIBaseUrl;
  const apiKey = openAIApiKey;
  if (!baseUrl) {
    throw new Error("OPENAI_BASE_URL is required for JSON generation.");
  }
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for JSON generation.");
  }
  const model = input.model || process.env.OPENAI_MODEL;
  if (!model) {
    throw new Error("OPENAI_MODEL is required for JSON generation.");
  }
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: input.maxTokens ?? maxTokens,
        temperature: input.temperature,
        response_format: { type: "json_object" },
        messages: input.messages,
      }),
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `JSON chat completion failed: ${response.status} ${body.slice(0, 500)}`,
    );
  }
  const parsed = JSON.parse(body) as {
    choices?: Array<{
      finish_reason?: string;
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
  };
  const firstChoice = parsed.choices?.[0];
  const content = chatCompletionContentText(firstChoice?.message?.content);
  if (!content) {
    const finishReason = firstChoice?.finish_reason
      ? ` Finish reason: ${firstChoice.finish_reason}.`
      : "";
    throw new Error(
      `JSON chat completion returned no message content.${finishReason}`,
    );
  }
  return content;
}

function chatCompletionContentText(
  content: string | Array<{ type?: string; text?: string }> | undefined,
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
}
