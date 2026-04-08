import { serve } from "@hono/node-server";
import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotEndpoint,
} from "@copilotkit/runtime/v2";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

// ---------------------------------------------------------------------------
// Intelligence (threads) configuration
// ---------------------------------------------------------------------------

const intelligenceApiUrl =
  process.env.INTELLIGENCE_API_URL ?? "http://localhost:4201";
const intelligenceGatewayWsUrl =
  process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4401";
const intelligenceApiKey =
  process.env.INTELLIGENCE_API_KEY ?? "cpk_sPRVSEED_seed0privat0longtoken00";
const intelligenceOrganizationId =
  process.env.INTELLIGENCE_ORGANIZATION_ID ?? "casa-de-erlang";

const intelligence = new CopilotKitIntelligence({
  apiKey: intelligenceApiKey,
  apiUrl: intelligenceApiUrl,
  wsUrl: intelligenceGatewayWsUrl,
  organizationId: intelligenceOrganizationId,
});

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

const agent = new LangGraphAgent({
  deploymentUrl:
    process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123",
  graphId: "sample_agent",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

const runtime = new CopilotRuntime({
  intelligence,
  identifyUser: () => ({ id: "jordan-beamson" }),
  licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
  agents: { default: agent },
  a2ui: { injectA2UITool: true },
  mcpApps: {
    servers: [
      {
        type: "http",
        url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com",
        serverId: "example_mcp_app",
      },
    ],
  },
});

const endpoint = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

const port = Number(process.env.PORT) || 4000;

serve({ fetch: endpoint.fetch, port }, () => {
  console.log(`BFF ready at http://localhost:${port}`);
});
