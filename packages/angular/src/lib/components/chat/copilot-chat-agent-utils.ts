import type { AbstractAgent } from "@ag-ui/client";

export function isCopilotKitAgent(agent: AbstractAgent): boolean {
  return "isCopilotKitAgent" in agent;
}
