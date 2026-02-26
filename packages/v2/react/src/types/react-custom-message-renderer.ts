import { Message } from "@ag-ui/core";
import type { AgentId } from "./copilotkit-types";

export type ReactCustomMessageRendererPosition = "before" | "after";

export interface ReactCustomMessageRenderer {
  agentId?: AgentId;
  render: React.ComponentType<{
    message: Message;
    position: ReactCustomMessageRendererPosition;
    runId: string;
    messageIndex: number;
    messageIndexInRun: number;
    numberOfMessagesInRun: number;
    agentId: string;
    stateSnapshot: any;
  }> | null;
}
