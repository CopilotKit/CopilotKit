import { Mastra } from "@mastra/core/mastra";
import { Agent } from "@mastra/core/agent";
import { registerCopilotKit } from "@ag-ui/mastra/copilotkit";
import { getLocalAgent } from "@ag-ui/mastra";

import { openai } from "../../../../src/mastra/_header_forwarding";

const dashboardAgent = new Agent({
  id: "declarative-gen-ui",
  name: "Dashboard",
  model: openai("gpt-5-mini"),
  instructions:
    "For dashboard requests, call generate_a2ui to render the dashboard, then reply in one sentence.",
});

export const mastra = new Mastra({
  agents: { dashboardAgent },
  server: {
    apiRoutes: [
      registerCopilotKit({
        path: "/copilotkit",
        resourceId: "demo-user",
        agents: () => {
          const agent = getLocalAgent({
            mastra,
            agentId: "dashboardAgent",
            resourceId: "demo-user",
          });
          if (!agent) throw new Error("dashboardAgent is not registered");
          return { "declarative-gen-ui": agent, default: agent };
        },
        a2ui: {
          injectA2UITool: true,
          defaultCatalogId: "declarative-gen-ui-catalog",
        },
        cors: { origin: "http://localhost:3000" },
      }),
    ],
  },
});
