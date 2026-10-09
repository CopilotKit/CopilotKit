import { HttpAgent } from "@ag-ui/client";

// SERVER-SAFE. No client directive, no JSX, no React — imported only by
// `src/shell/agent-registry.ts`, never by the client skin module.

/**
 * Myelin's agent is a GOOGLE ADK agent in Python (`agent-myelin/`), served over
 * AG-UI by `ag-ui-adk` and reached here as a plain `HttpAgent` — the same shape
 * banking uses for its LangChain agent. Nothing about CopilotKit is specific to
 * the framework on the other end: the browser's frontend tools, the
 * human-in-the-loop cards and the Intelligence memory tools all reach the ADK
 * model through `AGUIToolset()` on the Python side.
 *
 * Its server tools (create_journey, add_item, check_audience, publish_journey, …)
 * write to this app's REST API at `/api/myelin/v1/*`, which is the same ledger
 * the pages read — so the admin watches the journey build in the builder while
 * the agent works, and a second admin's window sees it too.
 */
export const myelinAgent = (): HttpAgent =>
  new HttpAgent({
    url: process.env.MYELIN_AGENT_URL ?? "http://localhost:8125/",
  });
