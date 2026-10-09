import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubagentActivityProvider } from "@/shell/subagents/subagent-activity";
import { HarnessConsole } from "./harness-console";

// The provider folds the live AG-UI event stream from `agent.subscribe`. Serve
// a fake agent whose subscriber the test can drive, and no thread id so the
// persisted-event seed stays out of the way.
const { subscribers } = vi.hoisted(() => ({
  subscribers: [] as { onEvent: (arg: { event: unknown }) => void }[],
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  UseAgentUpdate: {
    OnMessagesChanged: "OnMessagesChanged",
    OnRunStatusChanged: "OnRunStatusChanged",
  },
  useAgent: () => ({
    agent: {
      isRunning: false,
      messages: [],
      subscribe: (subscriber: {
        onEvent: (arg: { event: unknown }) => void;
      }) => {
        subscribers.push(subscriber);
        return { unsubscribe: () => undefined };
      },
    },
  }),
  useCopilotChatConfiguration: () => ({ threadId: undefined }),
}));

const emit = (...events: Record<string, unknown>[]) => {
  for (const event of events)
    for (const subscriber of subscribers) subscriber.onEvent({ event });
};

/**
 * One delegated run: the parent's `task` call starts a top-level analyst, which
 * runs a shell command and delegates once more to a nested researcher.
 */
const run = (n: number) => [
  {
    type: "SUBAGENT_STARTED",
    subagentRunId: `analyst-${n}`,
    name: "expense-analyst",
    parentToolCallId: `parent-task-${n}`,
  },
  {
    type: "TOOL_CALL_START",
    subagentRunId: `analyst-${n}`,
    toolCallId: `exec-${n}`,
    toolCallName: "execute",
  },
  {
    type: "TOOL_CALL_ARGS",
    subagentRunId: `analyst-${n}`,
    toolCallId: `exec-${n}`,
    delta: JSON.stringify({ command: `echo run-${n}-analyst` }),
  },
  {
    type: "SUBAGENT_STARTED",
    subagentRunId: `researcher-${n}`,
    name: "merchant-researcher",
    parentSubagentRunId: `analyst-${n}`,
    parentToolCallId: `nested-task-${n}`,
  },
  {
    type: "TOOL_CALL_START",
    subagentRunId: `researcher-${n}`,
    toolCallId: `search-${n}`,
    toolCallName: "search_merchant",
  },
  {
    type: "TOOL_CALL_ARGS",
    subagentRunId: `researcher-${n}`,
    toolCallId: `search-${n}`,
    delta: JSON.stringify({ query: `run-${n}-merchant` }),
  },
];

const renderConsoles = (anchors: string[]) =>
  render(
    <SubagentActivityProvider>
      {anchors.map((id) => (
        <div key={id} data-testid={id}>
          <HarnessConsole delegationToolCallId={id} />
        </div>
      ))}
    </SubagentActivityProvider>,
  );

const openConsoles = () => {
  for (const toggle of screen.getAllByRole("button", {
    name: /expense analysis/i,
  }))
    fireEvent.click(toggle);
};

const flushPublish = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
};

describe("HarnessConsole across runs on one thread", () => {
  afterEach(() => {
    cleanup();
    subscribers.length = 0;
  });

  it("shows each run only the lines of the subagent tree its task call started", async () => {
    renderConsoles(["parent-task-1", "parent-task-2"]);
    emit(...run(1), ...run(2));
    await flushPublish();
    openConsoles();

    const second = screen.getByTestId("parent-task-2");
    expect(second.textContent).toContain("$ echo run-2-analyst");
    expect(second.textContent).toContain('search "run-2-merchant"');
    expect(second.textContent).not.toContain("run-1-");

    const first = screen.getByTestId("parent-task-1");
    expect(first.textContent).toContain("$ echo run-1-analyst");
    expect(first.textContent).toContain('search "run-1-merchant"');
    expect(first.textContent).not.toContain("run-2-");
  });

  it("falls back to every line when the stream carries no parentToolCallId", async () => {
    renderConsoles(["parent-task-1"]);
    emit(
      ...[...run(1), ...run(2)].map((event) => {
        const legacy: Record<string, unknown> = { ...event };
        delete legacy.parentToolCallId;
        return legacy;
      }),
    );
    await flushPublish();
    openConsoles();

    const only = screen.getByTestId("parent-task-1");
    expect(only.textContent).toContain("$ echo run-1-analyst");
    expect(only.textContent).toContain("$ echo run-2-analyst");
  });
});
