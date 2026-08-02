import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

/**
 * Builds this starter's agent.
 *
 * Extracted from the runtime route so both mounts share one definition: the
 * route serves the web app over HTTP, and `channel-host.mts` serves a managed
 * Channel. A fresh instance per call — the channel host sets `threadId` per
 * conversation, so a shared instance would leak state across threads.
 */
export function createDefaultAgent(): LangGraphAgent {
  return new LangGraphAgent({
    deploymentUrl:
      process.env.AGENT_URL ||
      process.env.LANGGRAPH_DEPLOYMENT_URL ||
      "http://localhost:8123",
    graphId: "sample_agent",
    langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
  });
}
