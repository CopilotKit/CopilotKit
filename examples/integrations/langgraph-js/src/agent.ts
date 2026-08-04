import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

/** Builds this starter's agent. See channel-host.mts for why this is shared. */
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
