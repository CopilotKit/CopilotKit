import type { ɵThread } from "@copilotkit/core";
import type {
  ThreadDebuggerEvent,
  ThreadDebuggerMessage,
} from "../../../shared/thread-debugger/types.js";
import type { ExampleKind } from "../state.js";

export const THREADS_EXAMPLE_AGENT_ID = "threads-feature";

export type ExampleThread = ɵThread & { isExample: true };

export type ExampleThreadDetails = {
  messages: ThreadDebuggerMessage[];
  events: ThreadDebuggerEvent[];
  state: Record<string, unknown>;
};

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
        payload: { messageCount: 6, source: "thread-history" },
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
        payload: { status: "completed" },
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
        payload: { status: "completed" },
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
        payload: { status: "completed" },
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
