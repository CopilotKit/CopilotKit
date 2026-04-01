/**
 * High-level operation types that map to AG-UI event sequences.
 * Each operation expands into a full AG-UI event chain when dispatched.
 */
export type DevtoolsEventType =
  | "tool-call"
  | "text-message"
  | "reasoning"
  | "state-snapshot"
  | "custom-event";

/**
 * Event map for the TanStack DevTools EventClient.
 *
 * Keys use the format `copilotkit:<operation>`.
 * Core expands these into full AG-UI event sequences
 * (e.g. tool-call → RUN_STARTED → TOOL_CALL_START → TOOL_CALL_ARGS → TOOL_CALL_END → TOOL_CALL_RESULT → RUN_FINISHED).
 */
export interface CopilotKitDevtoolsEvents {
  "copilotkit:tool-call": {
    agentId: string;
    toolName: string;
    args: Record<string, unknown>;
    result: string;
  };
  "copilotkit:text-message": {
    agentId: string;
    content: string;
  };
  "copilotkit:reasoning": {
    agentId: string;
    content: string;
  };
  "copilotkit:state-snapshot": {
    agentId: string;
    state: Record<string, unknown>;
  };
  "copilotkit:custom-event": {
    agentId: string;
    name: string;
    value: unknown;
  };
}

/**
 * A saved event configuration that can be replayed.
 * `agentId` is intentionally excluded — it's picked from the UI at emit time,
 * making snippets reusable across agents.
 */
export interface DevtoolsSnippet {
  id: string;
  name: string;
  eventType: DevtoolsEventType;
  payload: Record<string, unknown>;
  createdAt: number;
}
