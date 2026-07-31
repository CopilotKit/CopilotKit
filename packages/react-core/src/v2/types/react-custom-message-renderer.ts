import type { Message } from "@ag-ui/core";

export type ReactCustomMessageRendererPosition = "before" | "after";

export interface ReactEphemeralMessage<T = unknown> {
  id: string;
  content: T;
  /** Persisted message ID after which this entry should render. */
  anchorMessageId?: string;
}

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
  renderEphemeral?: React.ComponentType<{
    message: ReactEphemeralMessage;
    agentId: string;
    threadId: string;
    messageIndex: number;
    numberOfMessages: number;
  }> | null;
}
