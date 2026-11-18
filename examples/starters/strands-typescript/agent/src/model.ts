import { AnthropicModel } from "@strands-agents/sdk/models/anthropic";
import { GoogleModel } from "@strands-agents/sdk/models/google";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import type { ClientOptions } from "openai";

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
 * The model this agent runs on.
 *
 * `COPILOTKIT_AGENT_MODEL` overrides it. When it is unset, it keeps this
 * starter's previous default: the OpenAI model named by the older `MODEL_ID`
 * variable, else gpt-6-luna. An OpenAI-compatible provider is `openai:<its model id>` plus
 * `OPENAI_BASE_URL`.
 */
export function resolveAgentModel(): AgentModelSpec {
  return parseAgentModel(
    process.env.COPILOTKIT_AGENT_MODEL?.trim() ||
      `openai:${process.env.MODEL_ID?.trim() || "gpt-6-luna"}`,
  );
}

const API_KEY_VARIABLES: Record<AgentModelProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
};

function requireApiKey(provider: AgentModelProvider): string {
  const name = API_KEY_VARIABLES[provider];
  const value =
    process.env[name] ||
    (provider === "google" ? process.env.GEMINI_API_KEY : undefined);
  if (!value) {
    throw new Error(`${name} is required. Add it to the starter's .env file.`);
  }
  return value;
}

/** Options for the OpenAI-SDK client the OpenAI model builds. */
export type OpenAIClientExtras = Pick<
  ClientOptions,
  "defaultHeaders" | "fetch"
>;

/** Build the Strands model for the agent. */
export function createStrandsModel(
  { provider, model }: AgentModelSpec,
  openaiExtras: OpenAIClientExtras,
) {
  const apiKey = requireApiKey(provider);
  switch (provider) {
    case "anthropic":
      return new AnthropicModel({ apiKey, modelId: model });
    case "google":
      return new GoogleModel({ apiKey, modelId: model });
    case "openai":
      return new OpenAIModel({
        apiKey,
        modelId: model,
        api: "chat",
        ...(model === "gpt-6-luna"
          ? { params: { reasoning_effort: "none" } }
          : {}),
        clientConfig: {
          ...(process.env.OPENAI_BASE_URL
            ? { baseURL: process.env.OPENAI_BASE_URL }
            : {}),
          ...openaiExtras,
        },
      });
  }
}
