import "../src/index.ts";
import type {
  CpkThreadInspector,
  ThreadDebuggerProvider,
} from "../src/index.ts";

type Scenario = "events" | "messages" | "raw";

const host = document.querySelector<HTMLElement>("#inspector-host");

if (!host) {
  throw new Error("Missing standalone inspector host element.");
}

const inspector = document.createElement(
  "cpk-thread-inspector",
) as CpkThreadInspector;

host.appendChild(inspector);

const scenarios: Record<
  Scenario,
  {
    label: string;
    threadId: string;
    provider: ThreadDebuggerProvider;
  }
> = {
  events: {
    label: "AG-UI events",
    threadId: "demo-events-thread",
    provider: {
      getThreadMetadata: async () => ({
        id: "demo-events-thread",
        name: "AG-UI event-backed thread",
        agentId: "demo-agent",
        endUserId: "demo-user",
        status: "completed",
        createdAt: "2026-06-25T10:00:00.000Z",
        updatedAt: "2026-06-25T10:00:04.000Z",
      }),
      getEvents: async () => [
        {
          type: "RUN_STARTED",
          timestamp: "2026-06-25T10:00:00.000Z",
          payload: { runId: "run-1" },
        },
        {
          type: "TEXT_MESSAGE_START",
          timestamp: "2026-06-25T10:00:01.000Z",
          payload: { messageId: "m1", role: "assistant" },
        },
        {
          type: "TEXT_MESSAGE_CONTENT",
          timestamp: "2026-06-25T10:00:02.000Z",
          payload: {
            messageId: "m1",
            delta: "Here is the event-derived timeline row.",
          },
        },
        {
          type: "TOOL_CALL_START",
          timestamp: "2026-06-25T10:00:03.000Z",
          payload: { toolCallId: "tc1", toolCallName: "lookup_docs" },
        },
        {
          type: "TOOL_CALL_ARGS",
          timestamp: "2026-06-25T10:00:03.250Z",
          payload: { toolCallId: "tc1", args: { query: "threads" } },
        },
        {
          type: "RUN_FINISHED",
          timestamp: "2026-06-25T10:00:04.000Z",
          payload: { runId: "run-1" },
        },
      ],
      getState: async () => ({ phase: "complete", selectedScenario: "events" }),
    },
  },
  messages: {
    label: "Messages only",
    threadId: "demo-messages-thread",
    provider: {
      getThreadMetadata: async () => ({
        id: "demo-messages-thread",
        name: "Message-backed thread",
        agentId: "demo-agent",
        endUserId: "demo-user",
        status: "completed",
      }),
      getEvents: async () => [],
      getMessages: async () => [
        {
          id: "u1",
          role: "user",
          content: "Show me the thread timeline.",
        },
        {
          id: "a1",
          role: "assistant",
          content: "This fallback is rendered from persisted messages.",
        },
      ],
      getState: async () => ({ selectedScenario: "messages" }),
    },
  },
  raw: {
    label: "Raw event only",
    threadId: "demo-raw-thread",
    provider: {
      getThreadMetadata: async () => ({
        id: "demo-raw-thread",
        name: "Raw event-backed thread",
        agentId: "demo-agent",
        endUserId: "demo-user",
        status: "active",
      }),
      getEvents: async () => [
        {
          type: "THREAD_STATE_WRITTEN",
          timestamp: "2026-06-25T10:00:00.000Z",
          payload: {
            checkpointId: "checkpoint-1",
            note: "Unsupported event types still render as raw timeline rows.",
          },
        },
      ],
      getState: async () => ({ selectedScenario: "raw" }),
    },
  },
};

function selectScenario(scenario: Scenario): void {
  const selected = scenarios[scenario];
  inspector.provider = selected.provider;
  inspector.threadId = selected.threadId;
  inspector.thread = null;

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-scenario]",
  )) {
    const active = button.dataset.scenario === scenario;
    button.setAttribute("aria-pressed", String(active));
    button.style.background = active ? "#eee6fe" : "#ffffff";
  }

  document.title = `CopilotKit Web Inspector Standalone - ${selected.label}`;
}

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-scenario]",
)) {
  button.addEventListener("click", () => {
    const scenario = button.dataset.scenario;
    if (
      scenario === "events" ||
      scenario === "messages" ||
      scenario === "raw"
    ) {
      selectScenario(scenario);
    }
  });
}

selectScenario("events");
