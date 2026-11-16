// The address of pydantic-ai's agent server inside its container.
import type { IntegrationEnv } from "@/lib/agents";

export default {
  AGENT_URL_PYDANTIC_AI: { port: 8000 },
} satisfies IntegrationEnv;
