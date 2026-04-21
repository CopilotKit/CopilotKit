import { serve } from "@hono/node-server";
import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotEndpoint,
} from "@copilotkit/runtime/v2";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const intelligence = new CopilotKitIntelligence({
  apiKey:
    process.env.INTELLIGENCE_API_KEY ?? "cpk_sPRVSEED_seed0privat0longtoken00",
  apiUrl: process.env.INTELLIGENCE_API_URL ?? "http://localhost:4201",
  wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4401",
  organizationId: process.env.INTELLIGENCE_ORGANIZATION_ID ?? "casa-de-erlang",
});

const agent = new LangGraphAgent({
  deploymentUrl:
    process.env.LANGGRAPH_DEPLOYMENT_URL ?? "http://localhost:8123",
  graphId: "sample_agent",
  langsmithApiKey: process.env.LANGSMITH_API_KEY ?? "",
});

const app = createCopilotEndpoint({
  basePath: "/api/copilotkit",
  runtime: new CopilotRuntime({
    intelligence,
    identifyUser: () => ({ id: "jordan-beamson" }),
    licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
    agents: { default: agent },
  }),
});

const port = Number(process.env.PORT) || 4000;

serve({ fetch: app.fetch, port }, () => {
  console.log(`BFF ready at http://localhost:${port}`);
});
