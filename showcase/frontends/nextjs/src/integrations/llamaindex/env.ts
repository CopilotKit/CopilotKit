// The address of llamaindex's agent server inside its container.
import type { IntegrationEnv } from "@/lib/agents";

export default {
  AGENT_URL_LLAMAINDEX: { port: 8000 },
} satisfies IntegrationEnv;
