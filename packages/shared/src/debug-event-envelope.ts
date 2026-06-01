import { BaseEvent } from "@ag-ui/client";

export interface DebugEventEnvelope {
  timestamp: number;
  agentId: string;
  threadId: string;
  runId: string;
  event: BaseEvent;
}
