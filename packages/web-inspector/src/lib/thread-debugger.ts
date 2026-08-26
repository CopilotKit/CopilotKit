import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { ɵThread } from "@copilotkit/core";

import type {
  ExampleKind,
  ExampleTourStep,
  ExampleTourTab,
  MetadataActionPlacement,
} from "./telemetry.js";

export type InspectorAgentEventType =
  | "RUN_STARTED"
  | "RUN_FINISHED"
  | "RUN_ERROR"
  | "STEP_STARTED"
  | "STEP_FINISHED"
  | "TEXT_MESSAGE_START"
  | "TEXT_MESSAGE_CONTENT"
  | "TEXT_MESSAGE_END"
  | "TOOL_CALL_START"
  | "TOOL_CALL_ARGS"
  | "TOOL_CALL_END"
  | "TOOL_CALL_RESULT"
  | "STATE_SNAPSHOT"
  | "STATE_DELTA"
  | "MESSAGES_SNAPSHOT"
  | "RAW_EVENT"
  | "CUSTOM_EVENT"
  | "REASONING_START"
  | "REASONING_MESSAGE_START"
  | "REASONING_MESSAGE_CONTENT"
  | "REASONING_MESSAGE_END"
  | "REASONING_END"
  | "REASONING_ENCRYPTED_VALUE"
  | "ACTIVITY_SNAPSHOT"
  | "ACTIVITY_DELTA";

export const AGENT_EVENT_TYPES: readonly InspectorAgentEventType[] = [
  "RUN_STARTED",
  "RUN_FINISHED",
  "RUN_ERROR",
  "STEP_STARTED",
  "STEP_FINISHED",
  "TEXT_MESSAGE_START",
  "TEXT_MESSAGE_CONTENT",
  "TEXT_MESSAGE_END",
  "TOOL_CALL_START",
  "TOOL_CALL_ARGS",
  "TOOL_CALL_END",
  "TOOL_CALL_RESULT",
  "STATE_SNAPSHOT",
  "STATE_DELTA",
  "MESSAGES_SNAPSHOT",
  "RAW_EVENT",
  "CUSTOM_EVENT",
  "REASONING_START",
  "REASONING_MESSAGE_START",
  "REASONING_MESSAGE_CONTENT",
  "REASONING_MESSAGE_END",
  "REASONING_END",
  "REASONING_ENCRYPTED_VALUE",
  "ACTIVITY_SNAPSHOT",
  "ACTIVITY_DELTA",
] as const;

export type SanitizedValue =
  | string
  | number
  | boolean
  | null
  | SanitizedValue[]
  | { [key: string]: SanitizedValue };

export type InspectorToolCall = {
  id?: string;
  function?: {
    name?: string;
    arguments?: SanitizedValue | string;
  };
  toolName?: string;
  status?: string;
};

export type InspectorMessage = {
  id?: string;
  role: string;
  contentText: string;
  contentRaw?: SanitizedValue;
  toolCalls: InspectorToolCall[];
  toolCallId?: string;
  /** Populated for role="activity" messages (Generative UI). */
  activityType?: string;
};

export type InspectorToolDefinition = {
  agentId: string;
  name: string;
  description?: string;
  parameters?: unknown;
  type: "handler" | "renderer";
};

export type InspectorEvent = {
  id: string;
  agentId: string;
  type: InspectorAgentEventType;
  timestamp: number;
  payload: SanitizedValue;
};

// ─── Thread details types ────────────────────────────────────────────────────

export type ThreadDebuggerProviderLoadOptions = {
  signal: AbortSignal;
};

export type ThreadDebuggerToolCall = {
  id: string;
  name: string;
  args: string | Record<string, unknown>;
};

export type ThreadDebuggerMessage = {
  id: string;
  role: string;
  content?: string;
  toolCalls?: ThreadDebuggerToolCall[];
  toolCallId?: string;
  /** Present when role === "activity" (Generative UI output). */
  activityType?: string;
};

export type ThreadDebuggerEvent = {
  type: string;
  timestamp: string | number;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ThreadDebuggerMetadata = {
  id: string;
  name?: string | null;
  agentId?: string | null;
  endUserId?: string | null;
  createdById?: string | null;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ThreadDebuggerProvider = {
  getThreadMetadata?: (
    threadId: string,
    options: ThreadDebuggerProviderLoadOptions,
  ) => Promise<ThreadDebuggerMetadata | null>;
  getMessages?: (
    threadId: string,
    options: ThreadDebuggerProviderLoadOptions,
  ) => Promise<ThreadDebuggerMessage[]>;
  getEvents?: (
    threadId: string,
    options: ThreadDebuggerProviderLoadOptions,
  ) => Promise<ThreadDebuggerEvent[]>;
  getState?: (
    threadId: string,
    options: ThreadDebuggerProviderLoadOptions,
  ) => Promise<Record<string, unknown> | null>;
};

export interface ConversationUser {
  id: string;
  type: "user";
  content: string;
  createdAt: string;
}

export interface ConversationAssistant {
  id: string;
  type: "assistant";
  content: string;
  createdAt: string;
}

export interface ConversationToolCall {
  id: string;
  type: "tool_call";
  toolName: string;
  toolCallId: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown> | null;
  createdAt: string;
  groupId?: string;
}

export interface ConversationReasoning {
  id: string;
  type: "reasoning";
  duration: string;
  createdAt: string;
}

export interface ConversationStateUpdate {
  id: string;
  type: "state_update";
  createdAt: string;
}

export interface ConversationAgentResponded {
  id: string;
  type: "agent_responded";
  createdAt: string;
}

export interface ConversationGenerativeUIItem {
  id: string;
  type: "generative-ui";
  activityType: string;
  createdAt: string;
}

export interface ToolCallGroup {
  type: "tool_call_group";
  id: string;
  items: ConversationToolCall[];
}

export type ConversationItem =
  | ConversationUser
  | ConversationAssistant
  | ConversationToolCall
  | ConversationReasoning
  | ConversationStateUpdate
  | ConversationAgentResponded
  | ConversationGenerativeUIItem;

export type RenderItem = ConversationItem | ToolCallGroup;

export interface ApiAgentEvent {
  type: string;
  timestamp: string | number;
  payload: Record<string, unknown>;
  sourceIndex?: number;
  rawEvent?: ThreadDebuggerEvent;
}

export type ThreadDetailsTab = "timeline" | "state" | "raw-events";
export type ThreadDetailsPanelCacheSlot =
  | ThreadDetailsTab
  | "timeline-fallback";

export type TimelineItemKind =
  | "message"
  | "tool"
  | "state"
  | "run"
  | "event"
  | "warning";

export type TimelineItem = {
  id: string;
  messageId?: string;
  kind: TimelineItemKind;
  title: string;
  body?: string;
  timestamp: string | number;
  sourceIndex: number;
  severity?: "warning" | "error";
  details?: Record<string, unknown>;
};

export type RuntimeEventsFetchResult =
  | { status: "available"; events: ThreadDebuggerEvent[] }
  | { status: "not-available" };

export type RuntimeStateFetchResult =
  | { status: "available"; state: Record<string, unknown> | null }
  | { status: "not-available" };

export type ExampleThread = ɵThread & { isExample: true };

export type ExampleThreadDetails = {
  messages: ThreadDebuggerMessage[];
  events: ThreadDebuggerEvent[];
  state: Record<string, unknown>;
};

export const THREADS_EXAMPLE_AGENT_ID = "threads-feature";

export const THREADS_EXAMPLE_THREADS: ExampleThread[] = [
  {
    id: "example-realtime-sync",
    name: "Realtime thread sync",
    agentId: THREADS_EXAMPLE_AGENT_ID,
    organizationId: "example-organization",
    createdById: "example-user",
    archived: false,
    createdAt: "2026-07-08T16:00:00.000Z",
    updatedAt: "2026-07-08T16:30:00.000Z",
    isExample: true,
  },
  {
    id: "example-manage-history",
    name: "Manage saved conversations",
    agentId: THREADS_EXAMPLE_AGENT_ID,
    organizationId: "example-organization",
    createdById: "example-user",
    archived: false,
    createdAt: "2026-07-07T17:45:00.000Z",
    updatedAt: "2026-07-07T18:15:00.000Z",
    isExample: true,
  },
  {
    id: "example-inspect-runs",
    name: "Inspect durable run history",
    agentId: THREADS_EXAMPLE_AGENT_ID,
    organizationId: "example-organization",
    createdById: "example-user",
    archived: false,
    createdAt: "2026-07-06T20:15:00.000Z",
    updatedAt: "2026-07-06T20:45:00.000Z",
    isExample: true,
  },
];

/** Map Sam's fixed example IDs to a closed telemetry vocabulary. */
export function getExampleKind(threadId: string): ExampleKind | undefined {
  switch (threadId) {
    case "example-realtime-sync":
      return "realtime_sync";
    case "example-manage-history":
      return "manage_history";
    case "example-inspect-runs":
      return "inspect_runs";
    default:
      return undefined;
  }
}

export const THREADS_EXAMPLE_DETAILS: Record<string, ExampleThreadDetails> = {
  "example-realtime-sync": {
    messages: [
      {
        id: "example-sync-user",
        role: "user",
        content: "Resume the checkout support thread from yesterday.",
      },
      {
        id: "example-sync-assistant",
        role: "assistant",
        content:
          "I found the saved thread, restored the cart state, and continued from the latest user message.",
      },
    ],
    events: [
      {
        type: "RUN_STARTED",
        timestamp: "2026-07-08T16:30:00.000Z",
        payload: {
          threadId: "example-realtime-sync",
          agentId: THREADS_EXAMPLE_AGENT_ID,
        },
      },
      {
        type: "MESSAGES_SNAPSHOT",
        timestamp: "2026-07-08T16:30:01.000Z",
        payload: {
          messageCount: 6,
          source: "thread-history",
        },
      },
      {
        type: "STATE_SNAPSHOT",
        timestamp: "2026-07-08T16:30:02.000Z",
        payload: {
          cartId: "cart_demo_42",
          checkoutStep: "shipping",
          resumed: true,
        },
      },
      {
        type: "RUN_FINISHED",
        timestamp: "2026-07-08T16:30:04.000Z",
        payload: {
          status: "completed",
        },
      },
    ],
    state: {
      cartId: "cart_demo_42",
      checkoutStep: "shipping",
      userIntent: "resume_previous_checkout",
      persistedThread: true,
    },
  },
  "example-manage-history": {
    messages: [
      {
        id: "example-history-user",
        role: "user",
        content: "Rename this saved support conversation for the handoff.",
      },
      {
        id: "example-history-assistant",
        role: "assistant",
        content:
          "Renamed the thread and kept the prior messages available for the next session.",
      },
    ],
    events: [
      {
        type: "RUN_STARTED",
        timestamp: "2026-07-07T18:15:00.000Z",
        payload: {
          threadId: "example-manage-history",
          agentId: THREADS_EXAMPLE_AGENT_ID,
        },
      },
      {
        type: "CUSTOM_EVENT",
        timestamp: "2026-07-07T18:15:01.000Z",
        payload: {
          action: "thread_renamed",
          previousName: "Untitled",
          name: "Billing escalation handoff",
        },
      },
      {
        type: "RUN_FINISHED",
        timestamp: "2026-07-07T18:15:03.000Z",
        payload: {
          status: "completed",
        },
      },
    ],
    state: {
      name: "Billing escalation handoff",
      savedMessages: 14,
      lastHandoff: "support-team",
    },
  },
  "example-inspect-runs": {
    messages: [
      {
        id: "example-inspect-user",
        role: "user",
        content: "Why did the assistant recommend the enterprise plan?",
      },
      {
        id: "example-inspect-assistant",
        role: "assistant",
        content:
          "The recommendation came from the account size, SSO requirement, and audit-log constraint in state.",
      },
    ],
    events: [
      {
        type: "RUN_STARTED",
        timestamp: "2026-07-06T20:45:00.000Z",
        payload: {
          threadId: "example-inspect-runs",
          agentId: THREADS_EXAMPLE_AGENT_ID,
        },
      },
      {
        type: "TOOL_CALL_START",
        timestamp: "2026-07-06T20:45:01.000Z",
        payload: {
          toolCallId: "call_account_lookup",
          toolName: "lookupAccount",
        },
      },
      {
        type: "TOOL_CALL_RESULT",
        timestamp: "2026-07-06T20:45:02.000Z",
        payload: {
          toolCallId: "call_account_lookup",
          seats: 220,
          requiresSso: true,
        },
      },
      {
        type: "RUN_FINISHED",
        timestamp: "2026-07-06T20:45:04.000Z",
        payload: {
          status: "completed",
        },
      },
    ],
    state: {
      accountTier: "growth",
      seats: 220,
      requiresSso: true,
      auditLogsRequired: true,
    },
  },
};

export const THREADS_EXAMPLE_TOUR_STEPS: ReadonlyArray<{
  tab: ThreadDetailsTab;
  label: string;
  title: string;
  body: string;
}> = [
  {
    tab: "timeline",
    label: "Messages",
    title: "Read the run as a story",
    body: "The timeline turns messages, tool calls, state changes, and run markers into a scannable debugging trail.",
  },
  {
    tab: "raw-events",
    label: "AG-UI Events",
    title: "Drop into the protocol payloads",
    body: "Raw events show the exact AG-UI stream behind the timeline when you need to verify ordering or payload shape.",
  },
  {
    tab: "state",
    label: "State",
    title: "Check the durable state",
    body: "The state tab shows the saved values that make a thread resumable across sessions.",
  },
];

export type ExampleTourTelemetryPair = Readonly<{
  tour_step: ExampleTourStep;
  tour_tab: ExampleTourTab;
}>;

/** Return only the three supported tour step/tab pairs. */
export function getExampleTourTelemetryPair(
  index: number,
): ExampleTourTelemetryPair | undefined {
  switch (index) {
    case 0:
      return { tour_step: 1, tour_tab: "timeline" };
    case 1:
      return { tour_step: 2, tour_tab: "raw-events" };
    case 2:
      return { tour_step: 3, tour_tab: "state" };
    default:
      return undefined;
  }
}

/** Convert rendered action placement to its stable telemetry key. */
export function getMetadataActionPlacement(
  placement: "threads-footer" | "locked",
): MetadataActionPlacement {
  return placement === "threads-footer" ? "threads_footer" : "threads_locked";
}

// ─── JSON syntax highlighter ─────────────────────────────────────────────────
// Inline-styled so shadow DOM encapsulation preserves colors when the output
// is injected via unsafeHTML. Only for structured data — never raw user HTML.

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Memoize highlight output by payload reference. Tab switches cause Lit to
// re-render the active panel from scratch, and the JSON.stringify + regex
// pass below is by far the most expensive thing in the events / state
// panels (potentially MB of agent state). Caching by object reference
// turns subsequent renders of an unchanged event list into near-zero JS work.
const highlightedJsonCache = new WeakMap<object, string>();

export function highlightedJson(obj: unknown): string {
  if (typeof obj === "object" && obj !== null) {
    const cached = highlightedJsonCache.get(obj);
    if (cached !== undefined) return cached;
  }
  const colors = {
    key: "#5558B2",
    str: "#087653",
    num: "#8a5900",
    bool: "#c0333a",
    nil: "#68686e",
  };
  const json = JSON.stringify(obj, null, 2);
  if (!json) return "";
  const parts: string[] = [];
  let lastIndex = 0;
  const re =
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(json)) !== null) {
    parts.push(escapeHtml(json.slice(lastIndex, match.index)));
    const m = match[0];
    let color = colors.num;
    if (m.startsWith('"')) {
      color = m.trimEnd().endsWith(":") ? colors.key : colors.str;
    } else if (m === "true" || m === "false") {
      color = colors.bool;
    } else if (m === "null") {
      color = colors.nil;
    }
    parts.push(`<span style="color:${color}">${escapeHtml(m)}</span>`);
    lastIndex = match.index + m.length;
  }
  parts.push(escapeHtml(json.slice(lastIndex)));
  const result = parts.join("");
  if (typeof obj === "object" && obj !== null) {
    highlightedJsonCache.set(obj, result);
  }
  return result;
}

export function coerceJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }

  const looksJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (!looksJson) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function renderHighlightedJsonBlock(
  value: unknown,
  options: { maxHeight?: string } = {},
) {
  const parsed = coerceJsonValue(value);
  const style = options.maxHeight
    ? `max-height:${options.maxHeight}`
    : undefined;
  return html`<pre class="cpk-json-block" style=${style || nothing}>
${unsafeHTML(highlightedJson(parsed))}</pre
  >`;
}

export function eventColors(type: string): { bg: string; fg: string } {
  if (type.startsWith("TEXT_MESSAGE")) return { bg: "#EEE6FE", fg: "#57575B" };
  if (type.startsWith("TOOL_CALL"))
    return { bg: "rgba(133,236,206,0.15)", fg: "#087653" };
  if (type.startsWith("STATE"))
    return { bg: "rgba(190,194,255,0.102)", fg: "#5558B2" };
  if (type === "RUN_ERROR" || type === "ERROR")
    return { bg: "rgba(250,95,103,0.13)", fg: "#c0333a" };
  if (type.startsWith("RUN_") || type.startsWith("STEP_"))
    return { bg: "rgba(255,172,77,0.2)", fg: "#8a5900" };
  return { bg: "#F7F7F9", fg: "#68686e" };
}

export function formatTimestamp(ts: string | number): string {
  const date = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return (
    date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }) +
    "." +
    ms
  );
}

export function formatRelativeTimestamp(ts: string | number): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";

  const elapsedSeconds = Math.max(
    1,
    Math.floor((Date.now() - date.getTime()) / 1_000),
  );
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds} ${elapsedSeconds === 1 ? "second" : "seconds"} ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  return `${elapsedMinutes} ${elapsedMinutes === 1 ? "minute" : "minutes"} ago`;
}
