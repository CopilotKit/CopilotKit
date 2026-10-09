import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";

/** The providers a `COPILOTKIT_AGENT_MODEL` value can name. */
export type AgentModelProvider = "openai" | "anthropic" | "google";

/** A parsed `<provider>:<model>` (or `<provider>/<model>`) model spec. */
export interface AgentModelSpec {
  provider: AgentModelProvider;
  model: string;
}

const PROVIDER_ALIASES: Record<string, AgentModelProvider> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  gemini: "google",
  "google-gemini": "google",
};

/**
 * Parse a `<provider>:<model>` or `<provider>/<model>` spec. The provider is
 * the leading token; everything after the first `:` or `/` is the model id,
 * unchanged (so `openai:meta-llama/llama-3.3-70b` keeps its slash).
 */
export function parseAgentModel(value: string): AgentModelSpec {
  const match = /^([A-Za-z0-9-]+)[:/](.+)$/.exec(value.trim());
  const provider = match && PROVIDER_ALIASES[match[1].toLowerCase()];
  if (!match || !provider) {
    throw new Error(
      `COPILOTKIT_AGENT_MODEL="${value}" is not <provider>:<model> with provider openai, anthropic or google`,
    );
  }
  return { provider, model: match[2] };
}

/**
 * Build the chat model for one call site.
 *
 * `COPILOTKIT_AGENT_MODEL` overrides EVERY model site in this agent when set;
 * when it is unset, each site falls back to its own `defaultSpec`. An
 * OpenAI-compatible provider is `openai:<its model id>` plus `OPENAI_BASE_URL`
 * (the OpenAI client reads that variable itself).
 *
 * @param defaultSpec - This site's default, e.g. `"openai:gpt-5.4"`.
 * @param openaiFields - Extra ChatOpenAI options, applied only for OpenAI.
 */
export function createChatModel(
  defaultSpec: string,
  openaiFields: ConstructorParameters<typeof ChatOpenAI>[0] = {},
): BaseChatModel {
  const { provider, model } = parseAgentModel(
    process.env.COPILOTKIT_AGENT_MODEL?.trim() || defaultSpec,
  );
  switch (provider) {
    case "anthropic":
      return new ChatAnthropic({ model });
    case "google":
      return new ChatGoogleGenerativeAI({ model });
    case "openai":
      return new ChatOpenAI({ ...openaiFields, model });
  }
}
