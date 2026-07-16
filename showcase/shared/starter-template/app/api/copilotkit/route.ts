import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { handle } from "hono/vercel";

const AGENT_URL =
  process.env.AGENT_URL ||
  process.env.LANGGRAPH_DEPLOYMENT_URL ||
  "http://localhost:8123";

if (!process.env.AGENT_URL && !process.env.LANGGRAPH_DEPLOYMENT_URL) {
  console.warn(
    "[copilotkit/route] WARNING: No AGENT_URL or LANGGRAPH_DEPLOYMENT_URL set, falling back to localhost:8123",
  );
}

const intelligenceApiUrl = process.env.INTELLIGENCE_API_URL;
const intelligenceWsUrl = process.env.INTELLIGENCE_GATEWAY_WS_URL;
const intelligenceApiKey = process.env.INTELLIGENCE_API_KEY;

const intelligenceEnabled = Boolean(
  intelligenceApiUrl && intelligenceWsUrl && intelligenceApiKey,
);

console.log("[copilotkit/route] Initializing CopilotKit runtime");
console.log(`[copilotkit/route] AGENT_URL: ${AGENT_URL}`);
console.log(
  `[copilotkit/route] Intelligence mode: ${
    intelligenceEnabled ? "enabled" : "disabled (OSS)"
  }`,
);

function createAgent(graphId: string = "sample_agent") {
  return new LangGraphAgent({
    deploymentUrl: AGENT_URL,
    graphId,
    langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
  });
}

const agentNames = [
  "sample_agent",
  "agentic_chat",
  "human_in_the_loop",
  "tool-rendering",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-write",
  "shared-state-streaming",
  "subagents",
  "default",
];

const agents: Record<string, LangGraphAgent> = {};
for (const name of agentNames) {
  agents[name] = createAgent();
}

const runtime = new CopilotRuntime({
  agents,
  // Conditionally configure intelligence when all three env vars are present
  ...(intelligenceEnabled
    ? {
        intelligence: new CopilotKitIntelligence({
          apiKey: intelligenceApiKey!,
          apiUrl: intelligenceApiUrl!,
          wsUrl: intelligenceWsUrl!,
        }),
        // Demo stub — replace with real auth-derived user identity for multi-user deployments
        identifyUser: () => ({ id: "demo-user", name: "Demo User" }),
      }
    : { runner: new InMemoryAgentRunner() }),
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
