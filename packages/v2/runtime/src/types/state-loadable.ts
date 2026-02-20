import type { Message } from "@ag-ui/client";

export interface LoadedAgentState {
  state: Record<string, any>;
  messages?: Message[];
}

export interface StateLoadableAgent {
  loadState(
    threadId: string,
    headers?: Record<string, string>,
  ): Promise<LoadedAgentState | null>;
}

export function isStateLoadable(agent: unknown): agent is StateLoadableAgent {
  return agent != null && typeof (agent as any).loadState === "function";
}
