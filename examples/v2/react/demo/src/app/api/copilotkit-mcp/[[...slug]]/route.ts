import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkitnext/runtime";
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
}).use(
  new MCPAppsMiddleware({
    // Port assignments - verified by checking each server's tools
    mcpServers: [
      { type: "http", url: "http://localhost:3101/mcp" }, // basic-server-react (get-time)
      { type: "http", url: "http://localhost:3102/mcp" }, // basic-server-vanillajs (get-time)
      { type: "http", url: "http://localhost:3103/mcp" }, // budget-allocator-server (get-budget-data)
      { type: "http", url: "http://localhost:3104/mcp" }, // cohort-heatmap-server (get-cohort-data)
      { type: "http", url: "http://localhost:3105/mcp" }, // customer-segmentation-server (get-customer-data)
      { type: "http", url: "http://localhost:3106/mcp" }, // integration-server (get-time)
      { type: "http", url: "http://localhost:3107/mcp" }, // scenario-modeler-server (get-scenario-data)
      { type: "http", url: "http://localhost:3108/mcp" }, // sheet-music-server (play-sheet-music)
      { type: "http", url: "http://localhost:3109/mcp" }, // system-monitor-server (get-system-stats)
      { type: "http", url: "http://localhost:3110/mcp" }, // threejs-server (show_threejs_scene)
      { type: "http", url: "http://localhost:3111/mcp" }, // video-resource-server (play_video)
      { type: "http", url: "http://localhost:3112/mcp" }, // wiki-explorer-server (get-first-degree-links)
    ],
  }),
);

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
