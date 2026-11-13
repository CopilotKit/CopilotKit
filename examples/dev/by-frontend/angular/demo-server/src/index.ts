import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  CopilotRuntime,
  createCopilotKitRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import { anthropicText } from "@tanstack/ai-anthropic";
import { geminiText } from "@tanstack/ai-gemini";
import { openaiText } from "@tanstack/ai-openai";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import { SlowToolCallStreamingAgent } from "./agents/slow-tool-call-streaming.js";
import { A2UIDashboardAgent } from "./agents/a2ui-dashboard.js";
import { GenerativeUIStoreAgent } from "./agents/generative-ui-store.js";

const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-opus-4-8";
const DEFAULT_OPENROUTER_MAX_OUTPUT_TOKENS = 16_384;

function determineOpenRouterModelId() {
  const configuredModel = process.env.OPENROUTER_MODEL?.trim();

  if (!configuredModel) {
    return DEFAULT_OPENROUTER_MODEL;
  }

  if (configuredModel.includes("/")) {
    return configuredModel;
  }

  return `openai/${configuredModel}`;
}

function determineOpenRouterMaxTokens() {
  const configuredLimit = Number(
    process.env.OPENROUTER_MAX_OUTPUT_TOKENS?.trim(),
  );

  if (Number.isSafeInteger(configuredLimit) && configuredLimit > 0) {
    return configuredLimit;
  }

  return DEFAULT_OPENROUTER_MAX_OUTPUT_TOKENS;
}

function determineModel() {
  if (openRouterApiKey) {
    return openaiCompatibleText(determineOpenRouterModelId(), {
      name: "openrouter",
      api: "chat-completions",
      apiKey: openRouterApiKey,
      baseURL: process.env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_URL,
    });
  }
  if (openAIApiKey) {
    return openaiText("gpt-6-luna");
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return anthropicText("claude-opus-4-8");
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return geminiText("gemini-3.8-flash");
  }
  // No key found: the OpenAI adapter throws an error that names OPENAI_API_KEY.
  return openaiText("gpt-6-luna");
}

// Options for the provider that determineModel picked, in that provider's
// own request format. OpenRouter gets Chat Completions, so its output cap is
// `max_tokens`.
function determineModelOptions() {
  if (openRouterApiKey) {
    return { max_tokens: determineOpenRouterMaxTokens() };
  }
  if (openAIApiKey) {
    return { reasoning: { effort: "high", summary: "detailed" } };
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return { thinking: { type: "adaptive" } };
  }
  return undefined;
}

const builtInAgent = new BuiltInAgent({
  model: determineModel(),
  prompt:
    "You are a helpful AI assistant. Use reasoning to answer the user's question. If you don't know the answer, say you don't know.",
  modelOptions: determineModelOptions(),
});

// --- MCP Apps ---------------------------------------------------------------
// Same scope as the React demo (examples/dev/by-frontend/react/demo): a BuiltInAgent wrapped in
// MCPAppsMiddleware, pointed at the same ext-apps servers, so the Angular host
// renders the same widgets.
//
// React exposes this as a SECOND runtime endpoint and re-points the provider per
// page. Angular resolves `provideCopilotKit` from the root injector, so a
// lazy-route override never takes effect; the agent is therefore registered by
// name on the existing runtime and the page selects it with `[agentId]`.
const mcpAgent = new BuiltInAgent({
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

const agents = {
  default: builtInAgent,
  "slow-tools": new SlowToolCallStreamingAgent(),
  "mcp-apps": mcpAgent,
  // Scripted A2UI v0.9 agent for the /a2ui-angular route; needs no API key.
  "a2ui-dashboard": new A2UIDashboardAgent(),
  // Native generative UI with the standard catalog, scripted (no API key).
  "generative-ui": new GenerativeUIStoreAgent(),
};

const runtime = new CopilotRuntime({
  agents,
  runner: new InMemoryAgentRunner(),
  // The native generative UI tool transport for model-backed agents. The
  // dashboard agent speaks A2UI v0.9: the runtime converts its surfaces to
  // A2UI 1.0 and sends clicks back to it in v0.9 form.
  generativeUI: { a2uiVersion: { "a2ui-dashboard": "0.9" } },
  openGenerativeUI: true,
});

// Create a main app with CORS enabled
const app = new Hono();

// Enable CORS for local dev (Angular demo at http://localhost:4200)
app.use(
  "*",
  cors({
    origin: "http://localhost:4200",
    allowMethods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "x-copilotcloud-public-api-key",
    ],
    exposeHeaders: ["Content-Type"],
    credentials: true,
    maxAge: 86400,
  }),
);

// Create the CopilotKit endpoint
const copilotApp = createCopilotKitRuntimeHandler({
  cors: true,
  runtime,
  basePath: "/api/copilotkit",
});

// Mount the CopilotKit app
app.all("/api/copilotkit/*", (c) => copilotApp(c.req.raw));

const port = Number(process.env.PORT || 3001);
const server = serve({ fetch: app.fetch, port });
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use. Stop the existing process or set PORT to another value.`,
    );
    process.exit(1);
  }

  throw error;
});
console.log(
  `CopilotKit runtime listening at http://localhost:${port}/api/copilotkit`,
);
