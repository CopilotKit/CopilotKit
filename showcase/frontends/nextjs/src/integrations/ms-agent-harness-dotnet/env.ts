// The address of the .NET agent server. entrypoint.sh starts it with
// `--urls http://0.0.0.0:8000`.
import type { IntegrationEnv } from "@/lib/agents";

export default {
  AGENT_URL_MS_AGENT_HARNESS_DOTNET: { port: 8000 },
} satisfies IntegrationEnv;
