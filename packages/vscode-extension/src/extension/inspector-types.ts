export interface DebugEventEnvelope {
  timestamp: number;
  agentId: string;
  threadId: string;
  runId: string;
  event: { type: string; [key: string]: unknown };
}

export type ConnectionStatus = "connected" | "disconnected" | "connecting";

export type InspectorToWebviewMessage =
  | { type: "debug-event"; envelope: DebugEventEnvelope }
  | { type: "connection-status"; status: ConnectionStatus }
  | { type: "connection-error"; error: string }
  | { type: "clear" };

export type InspectorFromWebviewMessage =
  | { type: "ready" }
  | { type: "connect"; runtimeUrl: string }
  | { type: "disconnect" }
  | { type: "clear" };
