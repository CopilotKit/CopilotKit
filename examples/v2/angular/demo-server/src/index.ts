import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import type { BuiltInAgentClassicConfig } from "@copilotkit/runtime/v2";
import { createOpenAI } from "@ai-sdk/openai";
import { SlowToolCallStreamingAgent } from "@copilotkit/demo-agents";

const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-4.6";
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
    return "anthropic/claude-3-7-sonnet-20250219";
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
        anthropic: { thinking: { type: "enabled", budgetTokens: 5000 } },
      }),
  },
});

const agents = {
  default: builtInAgent,
  "slow-tools": new SlowToolCallStreamingAgent(),
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
