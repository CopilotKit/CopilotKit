import { MockSocket } from "../../../../../../core/src/__tests__/test-utils";
import React from "react";
import { z } from "zod";
import type { ReactFrontendTool } from "../../../types/frontend-tool";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { Message } from "@ag-ui/client";
import {
  ProxiedCopilotRuntimeAgent,
  isRunCompletionAware,
} from "@copilotkit/core";
import { RUNTIME_MODE_INTELLIGENCE } from "@copilotkit/shared";
import { renderWithCopilotKit } from "../../../__tests__/utils/test-helpers";
import { CopilotChat } from "../CopilotChat";
import { CopilotChatView } from "../CopilotChatView";
import type { CopilotChatViewProps } from "../CopilotChatView";

const transport = vi.hoisted(() => ({ sockets: new Set<MockSocket>() }));
vi.mock("phoenix", () => ({
  Socket: class extends MockSocket {
    constructor(...args: ConstructorParameters<typeof MockSocket>) {
      super(...args);
      transport.sockets.add(this);
    }
  },
}));

const oldState = {
  todos: [
    { id: "cedar", title: "Cedar", status: "pending" },
    { id: "maple", title: "Maple", status: "pending" },
    { id: "oak", title: "Oak", status: "pending" },
  ],
};
const savedState = {
  todos: [
    { id: "cedar", title: "Cedar", status: "completed" },
    ...oldState.todos.slice(1),
    { id: "birch", title: "Birch", status: "pending" },
  ],
};

function SuggestionChatView(props: CopilotChatViewProps) {
  return (
    <>
      <button
        onClick={() =>
          props.onSelectSuggestion?.(
            {
              title: "Read todos",
              isLoading: false,
              message: "Read saved todos without modifying them",
            },
            0,
          )
        }
      >
        Read todos
      </button>
      <CopilotChatView {...props} />
    </>
  );
}

function SwitchableChat() {
  const [threadId, setThreadId] = React.useState("test-thread");
  return (
    <>
      <button
        onClick={() =>
          setThreadId((current) =>
            current === "test-thread" ? "other-thread" : "test-thread",
          )
        }
      >
        Switch thread
      </button>
      <CopilotChat
        threadId={threadId}
        welcomeScreen={false}
        chatView={SuggestionChatView}
      />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  transport.sockets.clear();
});

async function setupReplay(
  history: "completed" | "pending" | "ordinary" = "ordinary",
  holdRuns = false,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            threadId: "test-thread",
            runId: null,
            joinToken: "test-token",
            realtime: {
              clientUrl: "ws://localhost/client",
              topic: "thread:test-thread",
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  const runs: { state: unknown; messages: Message[] }[] = [];
  const runCompletions: (() => void)[] = [];
  vi.spyOn(ProxiedCopilotRuntimeAgent.prototype, "runAgent").mockImplementation(
    async function (this: ProxiedCopilotRuntimeAgent) {
      runs.push({
        state: structuredClone(this.state),
        messages: structuredClone(this.messages),
      });
      if (holdRuns)
        await new Promise<void>((resolve) => runCompletions.push(resolve));
      return { result: undefined, newMessages: [] };
    },
  );
  const agent = new ProxiedCopilotRuntimeAgent({
    agentId: "default",
    runtimeUrl: "http://localhost/runtime",
    runtimeMode: RUNTIME_MODE_INTELLIGENCE,
    intelligence: { wsUrl: "ws://localhost/client" },
  });
  const handler = vi.fn(async () => "approved");
  const tool: ReactFrontendTool = {
    name: "approval",
    parameters: z.object({}),
    type: history === "ordinary" ? "frontend" : "human-in-the-loop",
    handler,
    followUp: false,
  };
  const view = renderWithCopilotKit({
    agent,
    frontendTools: [tool],
    children: <SwitchableChat />,
  });
  const call: Message = {
    id: "approval-message",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "approval-call",
        type: "function",
        function: { name: "approval", arguments: "{}" },
      },
    ],
  };
  await waitFor(() =>
    expect([...transport.sockets][0]?.channels[0]?.joinCount).toBe(1),
  );
  const channel = [...transport.sockets][0]!.channels[0]!;
  await act(async () => {
    channel.triggerJoin("ok");
    channel.serverPush("ag_ui_event", {
      type: EventType.RUN_STARTED,
      run_id: "import",
      threadId: "test-thread",
      input: { messages: [] },
    });
    channel.serverPush("ag_ui_event", {
      type: EventType.STATE_SNAPSHOT,
      snapshot: oldState,
    });
    channel.serverPush("ag_ui_event", {
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [call],
    });
  });
  const finish = async (replayChannel = channel) => {
    await act(async () => {
      if (history === "completed") {
        replayChannel.serverPush("ag_ui_event", {
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [
            call,
            {
              id: "approval-result",
              role: "tool",
              toolCallId: "approval-call",
              content: "already approved",
            },
          ],
        });
      }
      replayChannel.serverPush("ag_ui_event", {
        type: EventType.STATE_SNAPSHOT,
        snapshot: savedState,
      });
      replayChannel.serverPush("replay_complete", { latestEventId: "saved" });
      replayChannel.serverPush("stream_idle", { latestEventId: "saved" });
    });
  };
  const submit = async (value = "Read saved todos without modifying them") => {
    const input = await screen.findByRole("textbox");
    await act(async () => {
      fireEvent.change(input, {
        target: { value },
      });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    });
  };
  const finishRun = async () => {
    await act(async () => runCompletions.shift()?.());
  };
  const failReplay = async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Replay unavailable"));
    await act(async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        [...transport.sockets][0]!.triggerError(
          new Error("Replay disconnected"),
        );
      }
    });
    await waitFor(() => expect(agent.isRunning).toBe(false));
  };
  return {
    agent,
    runs,
    finish,
    submit,
    channel,
    handler,
    finishRun,
    failReplay,
    ...view,
  };
}

describe.each(["completed", "pending", "ordinary"] as const)(
  "submission during %s history replay",
  (history) => {
    it.each(["early", "settled"] as const)(
      "sends the saved state after %s submission",
      async (timing) => {
        const { agent, runs, finish, submit, channel, handler } =
          await setupReplay(history);
        // Intelligence hydrates in a delegate, so the proxy's own base-class
        // completion promise cannot serialize a send against this connection.
        expect(agent.isRunning).toBe(true);
        const maybeAware: unknown = agent;
        const completion = isRunCompletionAware(maybeAware)
          ? maybeAware.activeRunCompletionPromise
          : undefined;
        expect(completion).toBeUndefined();
        if (timing === "settled") await finish();
        await submit();
        if (timing === "early") {
          expect(runs).toHaveLength(0);
          expect(channel.left).toBe(false);
          await finish();
        }
        await waitFor(() => expect(runs).toHaveLength(1));
        expect(handler).toHaveBeenCalledTimes(history === "pending" ? 1 : 0);
        expect(runs[0]?.state).toEqual(savedState);
        expect(runs[0]?.messages.at(-1)?.content).toBe(
          "Read saved todos without modifying them",
        );
      },
    );
  },
);

it("waits for a generic active agent run after history connection resolves", async () => {
  const { agent, runs, finish, submit, finishRun } = await setupReplay(
    "ordinary",
    true,
  );
  await finish();
  // This is the generic HttpAgent lifecycle shape after connect() has already
  // resolved: a run is active, but the agent has no completion-promise
  // extension for CopilotChat to await.
  agent.isRunning = true;
  expect(agent.isRunning).toBe(true);
  expect(isRunCompletionAware(agent as unknown)).toBe(false);

  const subscribe = agent.subscribe.bind(agent);
  let finalizeActiveRun: (() => void) | undefined;
  vi.spyOn(agent, "subscribe").mockImplementation((observer) => {
    if (observer.onRunFinalized) {
      finalizeActiveRun = () => observer.onRunFinalized?.({} as any);
      return { unsubscribe: vi.fn() } as any;
    }
    return subscribe(observer);
  });
  await submit("Send after replay");
  expect(runs).toHaveLength(0);

  await act(async () => finalizeActiveRun?.());
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(runs[0]?.messages.at(-1)?.content).toBe("Send after replay");
  await finishRun();
});

it("releases a queued send when a generic active agent run fails", async () => {
  const { agent, runs, finish, submit, finishRun } = await setupReplay(
    "ordinary",
    true,
  );
  await finish();
  agent.isRunning = true;

  const subscribe = agent.subscribe.bind(agent);
  let failActiveRun: (() => void) | undefined;
  vi.spyOn(agent, "subscribe").mockImplementation((observer) => {
    if (observer.onRunFailed) {
      failActiveRun = () => {
        agent.isRunning = false;
        observer.onRunFailed?.({
          error: new Error("Active run failed"),
        } as Parameters<NonNullable<typeof observer.onRunFailed>>[0]);
      };
      return { unsubscribe: vi.fn() } as any;
    }
    return subscribe(observer);
  });
  await submit("Send after failed run");
  expect(runs).toHaveLength(0);

  await act(async () => failActiveRun?.());
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(runs[0]?.messages.at(-1)?.content).toBe("Send after failed run");
  await finishRun();
});

it("does not dispatch a queued prompt after the chat unmounts", async () => {
  const { runs, submit, unmount } = await setupReplay();
  await submit();
  await act(async () => unmount());
  expect(runs).toHaveLength(0);
});

it("keeps a queued prompt in the composer when replay fails", async () => {
  const { runs, submit } = await setupReplay();
  await submit();
  // A connect retries dropped sockets indefinitely. Fail the credentials
  // refresh to terminate replay instead of just opening another socket.
  vi.mocked(fetch).mockRejectedValueOnce(new Error("Replay unavailable"));
  await act(async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      [...transport.sockets][0]!.triggerError(new Error("Replay disconnected"));
    }
  });
  await screen.findByText(
    "Could not load saved conversation. Reopen the thread and try again.",
  );
  expect(
    screen.getByDisplayValue("Read saved todos without modifying them"),
  ).toBeDefined();
  await submit();
  expect(
    screen.getByDisplayValue("Read saved todos without modifying them"),
  ).toBeDefined();
  expect(runs).toHaveLength(0);
});

it("discards a queued prompt when selecting another thread", async () => {
  const { runs, submit, finish } = await setupReplay();
  await submit();
  await act(async () => fireEvent.click(screen.getByText("Switch thread")));
  await finish();
  expect(runs).toHaveLength(0);
  expect(
    screen.queryByDisplayValue("Read saved todos without modifying them"),
  ).toBeNull();
});

it("waits for saved state before dispatching a suggestion", async () => {
  const { runs, finish } = await setupReplay();
  await act(async () => fireEvent.click(screen.getByText("Read todos")));
  expect(runs).toHaveLength(0);
  await finish();
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(runs[0]?.state).toEqual(savedState);
  expect(runs[0]?.messages.at(-1)?.content).toBe(
    "Read saved todos without modifying them",
  );
});

it("blocks a prompt submitted after replay has already failed", async () => {
  const { runs, submit, failReplay } = await setupReplay();
  await failReplay();
  await submit();
  expect(runs).toHaveLength(0);
  expect(
    screen.getByDisplayValue("Read saved todos without modifying them"),
  ).toBeDefined();
  expect(
    screen.getByText(
      "Could not load saved conversation. Reopen the thread and try again.",
    ),
  ).toBeDefined();
});

it.each(["typed", "suggestion"] as const)(
  "serializes a queued prompt followed by a %s through run completion",
  async (second) => {
    const { runs, submit, finish, finishRun } = await setupReplay(
      "ordinary",
      true,
    );
    await submit("First prompt");
    if (second === "typed") await submit("Second prompt");
    else await act(async () => fireEvent.click(screen.getByText("Read todos")));
    expect(runs).toHaveLength(0);
    await finish();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.messages.at(-1)?.content).toBe("First prompt");
    await finishRun();
    await waitFor(() => expect(runs).toHaveLength(2));
    expect(runs[1]?.messages.at(-1)?.content).toBe(
      second === "typed"
        ? "Second prompt"
        : "Read saved todos without modifying them",
    );
    await finishRun();
  },
);

it.each(["switch", "unmount"] as const)(
  "discards the remaining queue on %s while a submitted run is active",
  async (action) => {
    const { runs, submit, finish, finishRun, unmount } = await setupReplay(
      "ordinary",
      true,
    );
    await submit("First prompt");
    await submit("Abandoned prompt");
    await finish();
    expect(runs).toHaveLength(1);
    await act(async () => {
      if (action === "switch")
        fireEvent.click(screen.getByText("Switch thread"));
      else unmount();
    });
    await finishRun();
    expect(runs).toHaveLength(1);
  },
);

it("allows submission after reopening a failed conversation and replaying successfully", async () => {
  const { runs, submit, failReplay, finish } = await setupReplay();
  await failReplay();
  await submit();
  expect(runs).toHaveLength(0);
  await act(async () => fireEvent.click(screen.getByText("Switch thread")));
  const previousSockets = transport.sockets.size;
  await act(async () => fireEvent.click(screen.getByText("Switch thread")));
  await waitFor(() =>
    expect(transport.sockets.size).toBeGreaterThan(previousSockets),
  );
  const channel = [...transport.sockets].at(-1)!.channels[0]!;
  await waitFor(() => expect(channel.joinCount).toBe(1));
  await act(async () => {
    channel.triggerJoin("ok");
    channel.serverPush("ag_ui_event", {
      type: EventType.RUN_STARTED,
      run_id: "reopened",
      threadId: "test-thread",
      input: { messages: [] },
    });
  });
  await finish(channel);
  await submit();
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(runs[0]?.state).toEqual(savedState);
});
