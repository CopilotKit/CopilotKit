import { OmnaraAgent } from "@ag-ui/omnara";
import { omnaraConfig } from "./omnara-config";
import { backendTools } from "./backend-tools";

// @region[agent-setup]
/** Local demo agents only. Public identity and Intelligence are tracked in PNI-774. */
export function createAgents(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, OmnaraAgent> {
  const config = { ...omnaraConfig(env), user: "anonymous" as const };
  return {
    agentic_chat: new OmnaraAgent({ ...config, agentId: "agentic_chat" }),
    frontend_tools: new OmnaraAgent({ ...config, agentId: "frontend_tools" }),
    "tool-rendering-default-catchall": new OmnaraAgent({
      ...config,
      agentId: "tool-rendering-default-catchall",
      backendTools,
    }),
  };
}
// @endregion[agent-setup]
