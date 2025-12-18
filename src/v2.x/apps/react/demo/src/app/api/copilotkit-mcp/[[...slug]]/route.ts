import { CopilotRuntime, createCopilotEndpoint, InMemoryAgentRunner } from "@copilotkitnext/runtime";
import { handle } from "hono/vercel";
import { BasicAgent } from "@copilotkitnext/agent";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";

const determineModel = () => {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return "openai/gpt-4o";
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return "anthropic/claude-sonnet-4.5";
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return "google/gemini-2.5-pro";
  }
  return "openai/gpt-4o";
};

const agent = new BasicAgent({
  model: determineModel(),
  prompt: "You are a helpful AI assistant with access to MCP apps and tools.",
  temperature: 0.7,
}).use(new MCPAppsMiddleware({
  mcpServers: [
    { type: "http", url: "http://localhost:3001/mcp" }
  ],
}));

const honoRuntime = new CopilotRuntime({
  agents: {
    default: agent,
  },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotEndpoint({
  runtime: honoRuntime,
  basePath: "/api/copilotkit-mcp",
});

export const GET = handle(app);
export const POST = handle(app);
