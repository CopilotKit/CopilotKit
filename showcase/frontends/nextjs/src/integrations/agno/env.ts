// The agno agent server. One process on port 8000 serves every demo's agent.
import type { IntegrationEnv } from "@/lib/agents";

export default {
  AGENT_URL_AGNO: { port: 8000 },
} satisfies IntegrationEnv;
