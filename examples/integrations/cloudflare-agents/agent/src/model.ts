/**
 * The model every call in this agent uses, picked by COPILOTKIT_AGENT_MODEL.
 *
 * The value is `openai:<model>` (or `openai/<model>`). The agent calls OpenAI
 * through the AI SDK's OpenAI provider; for an OpenAI-compatible provider,
 * use `openai:<its model id>`, set OPENAI_BASE_URL to its base URL and put its
 * key in OPENAI_API_KEY. Unset, the model is openai:gpt-6-luna.
 */
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel, streamText } from "ai";

/** The Worker bindings the model reads. */
export interface ModelEnv {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  COPILOTKIT_AGENT_MODEL?: string;
}

export const DEFAULT_AGENT_MODEL = "openai:gpt-6-luna";

/** The model id named by COPILOTKIT_AGENT_MODEL. */
export function resolveModelId(env: ModelEnv): string {
  const value = env.COPILOTKIT_AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL;
  const match = /^([A-Za-z0-9-]+)[:/](.+)$/.exec(value);
  if (!match || match[1].toLowerCase() !== "openai") {
    throw new Error(
      `COPILOTKIT_AGENT_MODEL="${value}" is not openai:<model>. This starter runs OpenAI models, or an OpenAI-compatible provider through OPENAI_BASE_URL.`,
    );
  }
  return match[2];
}

export interface AgentModel {
  model: LanguageModel;
  providerOptions?: Parameters<typeof streamText>[0]["providerOptions"];
}

/** The language model for this run, with the provider options it needs. */
export function createAgentModel(env: ModelEnv): AgentModel {
  const modelId = resolveModelId(env);
  const openai = createOpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL || undefined,
  });
  return {
    // Chat Completions rather than the Responses API, so OpenAI-compatible
    // providers (and the starter's offline test server) work too.
    model: openai.chat(modelId),
    // gpt-6-luna reasons by default; the starter runs it without reasoning
    // for quick replies.
    providerOptions:
      modelId === "gpt-6-luna"
        ? { openai: { reasoningEffort: "none" } }
        : undefined,
  };
}
