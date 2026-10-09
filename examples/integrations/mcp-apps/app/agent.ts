import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";

const PROVIDER_ALIASES: Record<string, "openai" | "anthropic" | "google"> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  gemini: "google",
  "google-gemini": "google",
};

/**
 * The agent's model, as the runtime's `provider/model` string.
 *
 * `COPILOTKIT_AGENT_MODEL=<provider>:<model>` (or `<provider>/<model>`)
 * overrides the default; providers are openai, anthropic and google (gemini
 * and google-gemini are aliases), and everything after the first `:` or `/`
 * is the model id, unchanged. An OpenAI-compatible provider is
 * `openai:<its model id>` plus `OPENAI_BASE_URL`, which the runtime reads.
 * The result is re-emitted as `provider/model`. The runtime reads its provider
 * up to the first `:` or `/` and keeps the rest of the model id unchanged, so a
 * model id that itself contains `/` (e.g. `meta-llama/llama-3.3-70b`) survives.
 * On an OpenAI-compatible host (an `OPENAI_BASE_URL` that is not OpenAI's or
 * Azure's), the runtime calls Chat Completions instead of the Responses API
 * (PE-706, CopilotKit #7726). Set `COPILOTKIT_OPENAI_API=responses` (or
 * `chat`) to choose the API yourself.
 */
export function resolveAgentModel(defaultSpec: string): string {
  const value = process.env.COPILOTKIT_AGENT_MODEL?.trim() || defaultSpec;
  const match = /^([A-Za-z0-9-]+)[:/](.+)$/.exec(value.trim());
  const provider = match && PROVIDER_ALIASES[match[1].toLowerCase()];
  if (!match || !provider) {
    throw new Error(
      `COPILOTKIT_AGENT_MODEL="${value}" is not <provider>:<model> with provider openai, anthropic or google`,
    );
  }
  return `${provider}/${match[2]}`;
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
    // unset, the agent uses gpt-5-mini.
    model: resolveAgentModel("openai:gpt-5-mini"),
    prompt: "You are a helpful assistant.",
  });

  for (const middleware of middlewares) {
    agent.use(middleware);
  }

  return agent;
}
