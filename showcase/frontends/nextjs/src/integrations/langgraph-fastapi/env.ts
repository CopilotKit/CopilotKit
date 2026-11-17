// The address variable of the langgraph-fastapi agents, and where it points
// inside the integration's container.
import type { IntegrationEnv } from "@/lib/agents";

export default {
  // The LangGraph server, which serves every graph.
  AGENT_URL_LANGGRAPH_FASTAPI: { port: 8123 },
} satisfies IntegrationEnv;
