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
  // Port assignments match ext-apps/examples/run-all.ts (sorted alphabetically, BASE_PORT=3101)
  mcpServers: [
    { type: "http", url: "http://localhost:3101/mcp" }, // basic-server-react
    { type: "http", url: "http://localhost:3102/mcp" }, // basic-server-vanillajs
    { type: "http", url: "http://localhost:3103/mcp" }, // budget-allocator-server
    { type: "http", url: "http://localhost:3104/mcp" }, // cohort-heatmap-server
    { type: "http", url: "http://localhost:3105/mcp" }, // customer-segmentation-server
    { type: "http", url: "http://localhost:3106/mcp" }, // integration-server
    // 3107: qr-server (skipped)
    { type: "http", url: "http://localhost:3108/mcp" }, // scenario-modeler-server
    { type: "http", url: "http://localhost:3109/mcp" }, // sheet-music-server
    // 3110: system-monitor-server (skipped - broken)
    { type: "http", url: "http://localhost:3111/mcp" }, // threejs-server
    { type: "http", url: "http://localhost:3112/mcp" }, // video-resource-server
    { type: "http", url: "http://localhost:3113/mcp" }, // wiki-explorer-server
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
