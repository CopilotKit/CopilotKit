import { anthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";

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
 * Build the AI SDK language model for one call site.
 *
 * `COPILOTKIT_AGENT_MODEL` overrides EVERY model site in this app when set;
 * when it is unset, each site falls back to its own `defaultSpec`. An
 * OpenAI-compatible provider is `openai:<its model id>` plus
 * `OPENAI_BASE_URL`, which the OpenAI provider reads itself. Note that
 * `openai(model)` calls the Responses API, so the compatible provider must
 * implement `/responses`.
 *
 * @param defaultSpec - This site's default, e.g. `"openai:gpt-5-mini"`.
 */
export function createLanguageModel(defaultSpec: string) {
  const { provider, model } = parseAgentModel(
    process.env.COPILOTKIT_AGENT_MODEL || defaultSpec,
  );
  switch (provider) {
    case "anthropic":
      return anthropic(model);
    case "google":
      // Accept GOOGLE_API_KEY (what the other starters use) as well as the
      // AI SDK's own GOOGLE_GENERATIVE_AI_API_KEY.
      return createGoogleGenerativeAI({
        apiKey:
          process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
          process.env.GOOGLE_API_KEY,
      })(model);
    case "openai":
      return openai(model);
  }
}
