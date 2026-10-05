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
      <button onClick={() => setThreadId("other-thread")}>Switch thread</button>
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
  vi.spyOn(ProxiedCopilotRuntimeAgent.prototype, "runAgent").mockImplementation(
    async function (this: ProxiedCopilotRuntimeAgent) {
      runs.push({
        state: structuredClone(this.state),
        messages: structuredClone(this.messages),
      });
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
  const finish = async () => {
    await act(async () => {
      if (history === "completed") {
        channel.serverPush("ag_ui_event", {
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
      channel.serverPush("ag_ui_event", {
        type: EventType.STATE_SNAPSHOT,
        snapshot: savedState,
      });
      channel.serverPush("replay_complete", { latestEventId: "saved" });
      channel.serverPush("stream_idle", { latestEventId: "saved" });
    });
  };
  const submit = async () => {
    const input = await screen.findByRole("textbox");
    await act(async () => {
      fireEvent.change(input, {
        target: { value: "Read saved todos without modifying them" },
      });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    });
  };
  return { agent, runs, finish, submit, channel, handler, ...view };
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
