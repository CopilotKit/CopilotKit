/**
 * Common fields present on every devtools event payload.
 */
interface DevtoolsEventBase {
  agentId: string;
}

/**
 * Event map for the TanStack DevTools EventClient.
 *
 * Keys use the format `copilotkit:<operation>`.
 * Core expands these into full AG-UI event sequences
 * (e.g. tool-call → RUN_STARTED → TOOL_CALL_START → TOOL_CALL_ARGS → TOOL_CALL_END → TOOL_CALL_RESULT → RUN_FINISHED).
 */
export interface CopilotKitDevtoolsEvents {
  "copilotkit:tool-call": DevtoolsEventBase & {
    toolName: string;
    args: Record<string, unknown>;
    result: string;
  };
  "copilotkit:text-message": DevtoolsEventBase & {
    content: string;
  };
  "copilotkit:reasoning": DevtoolsEventBase & {
    content: string;
  };
  "copilotkit:state-snapshot": DevtoolsEventBase & {
    state: Record<string, unknown>;
  };
  "copilotkit:custom-event": DevtoolsEventBase & {
    name: string;
    value: unknown;
  };
}

/**
 * High-level operation types derived from the event map keys.
 * Each operation expands into a full AG-UI event chain when dispatched.
 */
export type DevtoolsEventType =
  keyof CopilotKitDevtoolsEvents extends `copilotkit:${infer S}` ? S : never;

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
