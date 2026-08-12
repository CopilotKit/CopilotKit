import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";

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
    model: "openai/" + (process.env.OPENAI_MODEL ?? "gpt-4o"),
    prompt: "You are a helpful assistant.",
  });

  for (const middleware of middlewares) {
    agent.use(middleware);
  }

  return agent;
}
