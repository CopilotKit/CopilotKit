import { Message } from "@ag-ui/core";

export type ReactCustomMessageRendererPosition = "before" | "after";

export interface ReactCustomMessageRenderer {
  agentId?: string;
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
