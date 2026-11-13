import { Mastra } from "@mastra/core/mastra";
import { Agent } from "@mastra/core/agent";
import { registerApiRoute } from "@mastra/core/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
import { getLocalAgent } from "@ag-ui/mastra";

import { openai } from "../../../../src/mastra/_header_forwarding";

const dashboardAgent = new Agent({
  id: "declarative-gen-ui",
  name: "Dashboard",
  model: openai("gpt-5-mini"),
  instructions:
    "For dashboard requests, call generate_a2ui to render the dashboard, then reply in one sentence.",
});

const COPILOTKIT_PATH = "/copilotkit";

// `registerCopilotKit` from `@ag-ui/mastra/copilotkit` builds a CopilotKit 1.x
// runtime (`@copilotkit/runtime/v2`), which CopilotKit 2.0 removed. Until it
// supports 2.0, this route mounts the 2.0 runtime the same way: one route for
// every method, the Mastra agent through AG-UI, and no inbound authorization
// header forwarded to the model provider.
export const mastra = new Mastra({
  agents: { dashboardAgent },
  server: {
    apiRoutes: [
      registerApiRoute(COPILOTKIT_PATH, {
        method: "ALL",
        handler: async (c) => {
          const agent = getLocalAgent({
            mastra: c.get("mastra"),
            agentId: "dashboardAgent",
            resourceId: "demo-user",
          });
          if (!agent) throw new Error("dashboardAgent is not registered");
          const runtime = new CopilotRuntime({
            agents: { "declarative-gen-ui": agent, default: agent },
            generativeUI: {
              a2uiVersion: "0.9",
              injectA2UITool: true,
              defaultCatalogId: "declarative-gen-ui-catalog",
            },
          });
          const handler = createCopilotRuntimeHandler({
            runtime,
            basePath: COPILOTKIT_PATH,
            cors: { origin: "http://localhost:3000" },
            mode: "single-route",
          });
          const headers = new Headers(c.req.raw.headers);
          headers.delete("authorization");
          return handler(new Request(c.req.raw, { headers }));
        },
      }),
    ],
  },
});
