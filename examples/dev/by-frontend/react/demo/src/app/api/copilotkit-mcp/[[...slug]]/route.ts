import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { anthropicText } from "@tanstack/ai-anthropic";
import { geminiText } from "@tanstack/ai-gemini";
import { openaiText } from "@tanstack/ai-openai";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";

const determineModel = () => {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return openaiText("gpt-6-luna");
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return anthropicText("claude-sonnet-4-6");
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return geminiText("gemini-3.8-flash");
  }
  // No key found: the OpenAI adapter throws an error that names OPENAI_API_KEY.
  return openaiText("gpt-6-luna");
};

const agent = new BuiltInAgent({
  model: determineModel(),
  prompt: "You are a helpful AI assistant with access to MCP apps and tools.",
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

const runtime = new CopilotRuntime({
  agents: {
    default: agent,
  },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotRuntimeHandler({
  cors: true,
  runtime: runtime,
  basePath: "/api/copilotkit-mcp",
});

export const GET = app;
export const POST = app;
