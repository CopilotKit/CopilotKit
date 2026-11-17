// The address of langroid's agent server inside its container.
import type { IntegrationEnv } from "@/lib/agents";

export default {
  AGENT_URL_LANGROID: { port: 8000 },
} satisfies IntegrationEnv;
