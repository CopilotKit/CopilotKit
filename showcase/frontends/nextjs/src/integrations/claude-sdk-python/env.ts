// The address of claude-sdk-python's agent server inside its container.
import type { IntegrationEnv } from "@/lib/agents";

export default {
  AGENT_URL_CLAUDE_SDK_PYTHON: { port: 8000 },
} satisfies IntegrationEnv;
