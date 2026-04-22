export interface DebugEventEnvelope {
  timestamp: number;
  agentId: string;
  threadId: string;
  runId: string;
  event: { type: string; [key: string]: unknown };
}

export type ConnectionStatus = "connected" | "disconnected" | "connecting";

export interface Filters {
  eventTypes: Set<string>;
  search: string;
  agentId: string;
  runId: string;
}
