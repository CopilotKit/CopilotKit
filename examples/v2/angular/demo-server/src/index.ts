import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  BasicAgent,
  BuiltInAgent,
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import type { BuiltInAgentClassicConfig } from "@copilotkit/runtime/v2";
import { createOpenAI } from "@ai-sdk/openai";
import { SlowToolCallStreamingAgent } from "@copilotkit/demo-agents";

const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-opus-4-8";
const DEFAULT_OPENROUTER_MAX_OUTPUT_TOKENS = 16_384;

function determineOpenRouterModelId(): string {
  const configuredModel = process.env.OPENROUTER_MODEL?.trim();

  if (!configuredModel) {
    return DEFAULT_OPENROUTER_MODEL;
  }

  if (configuredModel.includes("/")) {
    return configuredModel;
  }

  return `openai/${configuredModel}`;
}

function determineMaxOutputTokens(): number | undefined {
  if (!openRouterApiKey) {
    return undefined;
  }

  const configuredLimit = Number(
    process.env.OPENROUTER_MAX_OUTPUT_TOKENS?.trim(),
  );

  if (Number.isSafeInteger(configuredLimit) && configuredLimit > 0) {
    return configuredLimit;
  }

  return DEFAULT_OPENROUTER_MAX_OUTPUT_TOKENS;
}

function determineModel(): BuiltInAgentClassicConfig["model"] {
  if (openRouterApiKey) {
    const openrouter = createOpenAI({
      apiKey: openRouterApiKey,
      baseURL: process.env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_URL,
    });

    return openrouter(determineOpenRouterModelId());
  }
  if (openAIApiKey) {
    return "openai/gpt-5.2";
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return "anthropic/claude-opus-4-8";
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return "google/gemini-2.5-pro";
  }
  return "openai/gpt-5.2";
}

const builtInAgent = new BuiltInAgent({
  model: determineModel(),
  maxOutputTokens: determineMaxOutputTokens(),
  prompt:
    "You are a helpful AI assistant. Use reasoning to answer the user's question. If you don't know the answer, say you don't know.",
  providerOptions: {
    ...(openAIApiKey
      ? { openai: { reasoningEffort: "high", reasoningSummary: "detailed" } }
      : {}),
    ...(!openAIApiKey &&
      !openRouterApiKey &&
      !!process.env.ANTHROPIC_API_KEY?.trim() && {
        anthropic: { thinking: { type: "adaptive" } },
      }),
  },
});

// --- MCP Apps ---------------------------------------------------------------
// Same scope as the React demo (examples/v2/react/demo): a BasicAgent wrapped in
// MCPAppsMiddleware, pointed at the same ext-apps servers, so the Angular host
// renders the same widgets.
//
// React exposes this as a SECOND runtime endpoint and re-points the provider per
// page. Angular resolves `provideCopilotKit` from the root injector, so a
// lazy-route override never takes effect; the agent is therefore registered by
// name on the existing runtime and the page selects it with `[agentId]`.
const mcpAgent = new BasicAgent({
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

const agents = {
  default: builtInAgent,
  "slow-tools": new SlowToolCallStreamingAgent(),
  "mcp-apps": mcpAgent,
};

const runtime = new CopilotRuntime({
  agents,
  runner: new InMemoryAgentRunner(),
  a2ui: {},
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
const copilotApp = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

// Mount the CopilotKit app
app.route("/", copilotApp);

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
