// The address variable of the langgraph-python agents, and where it points
// inside the integration's container.
import type { IntegrationEnv } from "@/lib/agents";

export default {
  // The LangGraph server, which serves every graph.
  AGENT_URL_LANGGRAPH_PYTHON: { port: 8123 },
} satisfies IntegrationEnv;
