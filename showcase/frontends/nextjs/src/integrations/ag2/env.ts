// The address of ag2's agent server inside its container.
import type { IntegrationEnv } from "@/lib/agents";

export default {
  AGENT_URL_AG2: { port: 8000 },
} satisfies IntegrationEnv;
