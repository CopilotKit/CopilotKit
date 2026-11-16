// The agents of each ms-agent-dotnet demo. Its .NET server has the same
// endpoints as ms-agent-harness-dotnet's, so both build their agents with
// dotnetRuntimeConfig.
import type { IntegrationRuntime } from "@/lib/agents";
import { dotnetRuntimeConfig } from "@/lib/dotnet-http-agents";

export default {
  createRuntimeConfig(demoId) {
    return dotnetRuntimeConfig("ms-agent-dotnet", demoId);
  },
} satisfies IntegrationRuntime;
