export type {
  Anchor,
  ContextKey,
  ContextState,
  DockMode,
  Position,
  Size,
} from "../shared/layout/types.js";

export type InspectorOpenOptions = {
  /** Select the thread that contains the message. */
  threadId?: string;
  /** Narrow the Threads view to the agent that owns the thread. */
  agentId?: string;
  /** Scroll the selected thread timeline to this message when available. */
  messageId?: string;
};

export type InspectorColorScheme = "light" | "dark";
