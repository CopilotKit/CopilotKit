import { HttpAgent } from "@ag-ui/client";
import {
  CopilotKitIntelligence,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { AGENT_ID } from "../lib/agent";

const apiKey = process.env.CPK_INTELLIGENCE_API_KEY;
if (!apiKey) {
  throw new Error(
    "CPK_INTELLIGENCE_API_KEY is not set. Copy .env.example to .env and add your Intelligence key.",
  );
}

/**
 * One ADK agent behind AG-UI, with Intelligence keeping the threads.
 *
 * Generative UI needs no option here. With the markdown transport the browser
 * sends the generative UI guide as context on each run, and the agent writes
 * A2UI into its reply as text; the runtime passes both through.
 */
const runtime = new CopilotRuntime({
  agents: {
    [AGENT_ID]: new HttpAgent({
      url: process.env.AGENT_URL ?? "http://localhost:8014/",
    }),
  },
  intelligence: new CopilotKitIntelligence({ apiKey }),
  // A single-user demo. Replace with your app's verified session before
  // deploying anywhere shared; see /auth#thread-authorization in the docs.
  identifyUser: () => ({
    id: "research-desk-demo",
    name: "A2UI Playground",
  }),
});

export const copilotKitHandler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});
