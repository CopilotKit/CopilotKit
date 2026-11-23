import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import { anthropicText } from "@tanstack/ai-anthropic";
import { geminiText } from "@tanstack/ai-gemini";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";

const PROVIDER_ALIASES: Record<string, "openai" | "anthropic" | "google"> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  gemini: "google",
  "google-gemini": "google",
};

const OPENAI_URL = "https://api.openai.com/v1";

/** True for OpenAI's own API and Azure OpenAI, which serve the Responses API. */
function isOpenAIHost(baseURL: string): boolean {
  const host = new URL(baseURL).hostname;
  return host === "api.openai.com" || host.endsWith(".openai.azure.com");
}

/**
 * The agent's model, as a TanStack AI text adapter.
 *
 * `COPILOTKIT_AGENT_MODEL=<provider>:<model>` (or `<provider>/<model>`)
 * overrides the default; providers are openai, anthropic and google (gemini
 * and google-gemini are aliases), and everything after the first `:` or `/`
 * is the model id, unchanged, so a model id that itself contains `/` (e.g.
 * `meta-llama/llama-3.3-70b`) survives. Each adapter reads its key from the
 * environment: OPENAI_API_KEY, ANTHROPIC_API_KEY or GOOGLE_API_KEY.
 *
 * An OpenAI-compatible provider is `openai:<its model id>` plus
 * `OPENAI_BASE_URL`. On a host that is not OpenAI's or Azure's, the agent calls
 * Chat Completions instead of the Responses API (PE-706, CopilotKit #7726). Set
 * `COPILOTKIT_OPENAI_API=responses` (or `chat`) to choose the API yourself.
 */
export function resolveAgentModel(defaultSpec: string) {
  const value = process.env.COPILOTKIT_AGENT_MODEL?.trim() || defaultSpec;
  const match = /^([A-Za-z0-9-]+)[:/](.+)$/.exec(value.trim());
  const provider = match && PROVIDER_ALIASES[match[1].toLowerCase()];
  if (!match || !provider) {
    throw new Error(
      `COPILOTKIT_AGENT_MODEL="${value}" is not <provider>:<model> with provider openai, anthropic or google`,
    );
  }
  const model = match[2];

  if (provider === "anthropic") {
    return anthropicText(model as Parameters<typeof anthropicText>[0]);
  }
  if (provider === "google") {
    return geminiText(model as Parameters<typeof geminiText>[0]);
  }

  const baseURL = process.env.OPENAI_BASE_URL?.trim() || OPENAI_URL;
  const choice = process.env.COPILOTKIT_OPENAI_API?.trim().toLowerCase();
  const api =
    choice === "chat"
      ? "chat-completions"
      : choice === "responses" || isOpenAIHost(baseURL)
        ? "responses"
        : "chat-completions";
  return openaiCompatibleText(model, {
    name: "openai",
    api,
    baseURL,
    apiKey: process.env.OPENAI_API_KEY ?? "",
  });
}

/**
 * Builds this starter's agent.
 *
 * The agent is hosted by the runtime itself — there is no agent server behind a
 * URL. The MCP middlewares are part of the agent's definition, so they are
 * applied here rather than at the mount: a Channel driving an agent without them
 * would silently lose its MCP tools.
 */
export function createDefaultAgent(): BuiltInAgent {
  const middlewares = [
    new MCPAppsMiddleware({
      mcpServers: [
        {
          type: "http",
          url: "http://localhost:3108/mcp",
          serverId: "threejs",
        },
      ],
    }),
  ];

  const agent = new BuiltInAgent({
    // COPILOTKIT_AGENT_MODEL (e.g. "anthropic:claude-sonnet-4-5") overrides this;
    // unset, the agent uses gpt-6-luna.
    model: resolveAgentModel("openai:gpt-6-luna"),
    prompt: "You are a helpful assistant.",
  });

  for (const middleware of middlewares) {
    agent.use(middleware);
  }

  return agent;
}
