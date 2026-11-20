import { OmnaraAgent } from "@ag-ui/omnara";
import { omnaraConfig } from "./omnara-config";
import { backendTools } from "./backend-tools";

const demoTools = {
  agentic_chat: undefined,
  frontend_tools: undefined,
  "tool-rendering-default-catchall": backendTools,
};

export type DemoAgentId = keyof typeof demoTools;

export function isDemoAgentId(value: unknown): value is DemoAgentId {
  return typeof value === "string" && Object.hasOwn(demoTools, value);
}

// @region[agent-setup]
export function createAgents(
  env: Readonly<Record<string, string | undefined>>,
  visitorId: string,
): Record<string, OmnaraAgent> {
  const config = { ...omnaraConfig(env), user: { id: visitorId } };
  return Object.fromEntries(
    Object.entries(demoTools).map(([agentId, tools]) => [
      agentId,
      new OmnaraAgent({ ...config, agentId, backendTools: tools }),
    ]),
  );
}
// @endregion[agent-setup]
