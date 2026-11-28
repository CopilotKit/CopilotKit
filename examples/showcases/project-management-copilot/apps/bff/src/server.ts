import { serve } from "@hono/node-server";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";
import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotHonoHandler,
} from "@copilotkit/runtime/v2";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { WhisperTranscriptionService } from "./whisper-transcription.js";

const useMock = process.env.USE_MOCK === "1";

if (useMock) {
  process.env.OPENAI_BASE_URL =
    process.env.OPENAI_BASE_URL ?? "http://localhost:4010/v1";
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "mock";
  console.log(
    "[bff] USE_MOCK=1 — routing OpenAI to",
    process.env.OPENAI_BASE_URL,
  );
}

const intelligence = new CopilotKitIntelligence({
  apiKey:
    process.env.INTELLIGENCE_API_KEY ?? "cpk_sPRVSEED_seed0privat0longtoken00",
  apiUrl: process.env.INTELLIGENCE_API_URL ?? "http://localhost:4201",
  wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4401",
});

// LangGraph agent — the original PM copilot. graphId is the langgraph.json
// id from apps/agent.
//
// Cast to AbstractAgent because @copilotkit/runtime/langgraph bundles its
// own copy of the AbstractAgent base class with a privately-scoped `_debug`
// field. Structural type-compat fails against @ag-ui/client's AbstractAgent
// ("Types have separate declarations of a private property '_debug'") even
// though they're the same class at runtime. Demo-only workaround; the real
// fix is upstream deduping the AbstractAgent re-export.
const langgraphAgent = new LangGraphAgent({
  deploymentUrl:
    process.env.LANGGRAPH_DEPLOYMENT_URL ?? "http://localhost:8123",
  graphId: "sample_agent",
  langsmithApiKey: process.env.LANGSMITH_API_KEY ?? "",
}) as unknown as AbstractAgent;

// Google ADK agent — same tool surface, exposed as a vanilla AG-UI HTTP
// endpoint by ag-ui-adk's FastAPI plumbing. We point HttpAgent at it; the
// frontend uses whichever agent the user picks from the agent selector.
const adkAgent = new HttpAgent({
  url: process.env.ADK_AGENT_URL ?? "http://localhost:8124/",
});

const transcriptionService = new WhisperTranscriptionService({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

const app = createCopilotHonoHandler({
  basePath: "/api/copilotkit",
  runtime: new CopilotRuntime({
    intelligence,
    identifyUser: () => ({ id: "jordan-beamson", name: "Jordan Beamson" }),
    licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
    agents: {
      // The frontend agent selector picks one of these by name. Both expose
      // the same tools — manage_issues / propose_issue_change / etc.
      default: langgraphAgent,
      langgraph: langgraphAgent,
      adk: adkAgent,
    },
    // Disable LLM-driven thread-name generation. The handler clones the
    // agent and runs it 3× per user message against random ephemeral
    // threadIds; those ephemeral runs get persisted on the Intelligence
    // platform with `lastRunAt` but no name, which leaked into the threads
    // drawer as phantom "New thread" rows. In USE_MOCK mode title-gen has
    // no fixture either, so all three attempts always fell back to
    // "Untitled". Frontend now handles naming entirely client-side via the
    // threads-drawer rebrand effect (null → agent-specific default with
    // reveal animation), so the BFF flow is pure noise.
    generateThreadNames: false,
    openGenerativeUI: true,
    transcriptionService,
    a2ui: {
      injectA2UITool: false,
    },
    mcpApps: {
      servers: [
        {
          type: "http",
          url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com",
          serverId: "example_mcp_app",
        },
      ],
    },
  }),
});

const port = Number(process.env.PORT) || 4000;

serve({ fetch: app.fetch, port }, () => {
  console.log(`BFF ready at http://localhost:${port}`);
});
