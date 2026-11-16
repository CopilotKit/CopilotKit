// The agents of each ms-agent-harness-dotnet demo. Its .NET server has the
// same endpoints as ms-agent-dotnet's, so both build their agents with
// dotnetRuntimeConfig.
import type { IntegrationRuntime } from "@/lib/agents";
import { dotnetRuntimeConfig } from "@/lib/dotnet-http-agents";

export default {
  createRuntimeConfig(demoId) {
    return dotnetRuntimeConfig("ms-agent-harness-dotnet", demoId);
  },
} satisfies IntegrationRuntime;
