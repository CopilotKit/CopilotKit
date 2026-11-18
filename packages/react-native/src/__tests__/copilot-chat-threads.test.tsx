/**
 * Thread restore and thread switching in the headless `<CopilotChat>`. Runs on
 * a REAL `CopilotKitCoreReact` (via `TestCopilotKit`), so the connect, the
 * reset on a switch to a fresh thread, and the send queue are core's
 * `ɵThreadSwitchCoordinator` and `ɵChatSubmitter`, as in the web chats.
 */
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Message, RunAgentResult } from "@ag-ui/client";
import { CopilotChat, useCopilotChatContext } from "../CopilotChat";
import { SeededAgent, TestCopilotKit } from "../__mocks__/test-copilotkit";
import type { CopilotChatContextValue } from "../CopilotChat";

const EMPTY_RESULT: RunAgentResult = { result: undefined, newMessages: [] };

const text = (id: string, content: string): Message => ({
  id,
  role: "assistant",
  content,
});

/**
 * An agent with stored threads. `connectAgent` restores the history of the
 * thread the agent is on, as the runtime's `/connect` does. A test can hold
 * the connect open with `holdConnect`.
 */
class ThreadedAgent extends SeededAgent {
  readonly connectedThreadIds: string[] = [];
  readonly runs: { threadId: string; messages: string[] }[] = [];
  private heldConnect: Promise<void> | undefined;
  private heldRun: Promise<void> | undefined;

  constructor(private readonly histories: Record<string, Message[]>) {
    super();
  }

  holdConnect() {
    let release!: () => void;
    this.heldConnect = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  override async connectAgent(): Promise<RunAgentResult> {
    const threadId = this.threadId;
    this.connectedThreadIds.push(threadId);
    await this.heldConnect;
    this.setMessages(this.histories[threadId] ?? []);
    return EMPTY_RESULT;
  }

  /** Holds the next run open; the returned function finishes it with a reply. */
  holdRun() {
    let release!: () => void;
    this.heldRun = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  override async runAgent(): Promise<RunAgentResult> {
    this.runs.push({
      threadId: this.threadId,
      messages: this.messages.map((m) => String(m.content)),
    });
    const held = this.heldRun;
    if (held) {
      this.heldRun = undefined;
      await held;
      this.addMessage(text("reply", "reply"));
    }
    return EMPTY_RESULT;
  }
}

let chat: CopilotChatContextValue | null = null;

function Transcript() {
  chat = useCopilotChatContext();
  return (
    <ul data-testid="transcript">
      {chat.messages.map((m: Message) => (
        <li key={m.id}>{String(m.content)}</li>
      ))}
    </ul>
  );
}

function renderChat(agent: ThreadedAgent, threadId?: string) {
  const agents = { x: agent };
  const view = (id?: string) => (
    <TestCopilotKit messages={[]} agents={agents}>
      <CopilotChat agentId="x" threadId={id}>
        <Transcript />
      </CopilotChat>
    </TestCopilotKit>
  );
  const result = render(view(threadId));
  return {
    switchTo: (id?: string) => result.rerender(view(id)),
    unmount: result.unmount,
  };
}

const transcript = () =>
  Array.from(screen.getByTestId("transcript").children).map(
    (li) => li.textContent,
  );

describe("headless CopilotChat threads", () => {
  it("restores the thread named by threadId", async () => {
    const agent = new ThreadedAgent({ t1: [text("a", "from t1")] });

    renderChat(agent, "t1");

    await waitFor(() => expect(transcript()).toEqual(["from t1"]));
    expect(agent.connectedThreadIds).toEqual(["t1"]);
    expect(agent.threadId).toBe("t1");
  });

  it("restores the new thread when threadId changes", async () => {
    const agent = new ThreadedAgent({
      t1: [text("a", "from t1")],
      t2: [text("b", "from t2")],
    });
    const { switchTo } = renderChat(agent, "t1");
    await waitFor(() => expect(transcript()).toEqual(["from t1"]));

    switchTo("t2");

    await waitFor(() => expect(transcript()).toEqual(["from t2"]));
    expect(agent.connectedThreadIds).toEqual(["t1", "t2"]);
    expect(agent.threadId).toBe("t2");
  });

  it("does not connect a chat without threadId, and gives the agent a new thread", () => {
    const agent = new ThreadedAgent({});
    const before = agent.threadId;

    renderChat(agent);

    expect(agent.connectedThreadIds).toEqual([]);
    expect(agent.threadId).toEqual(expect.any(String));
    expect(agent.threadId).not.toBe(before);
  });

  it("empties the chat when threadId is removed", async () => {
    const agent = new ThreadedAgent({ t1: [text("a", "from t1")] });
    const { switchTo } = renderChat(agent, "t1");
    await waitFor(() => expect(transcript()).toEqual(["from t1"]));

    switchTo(undefined);

    await waitFor(() => expect(transcript()).toEqual([]));
    expect(agent.threadId).not.toBe("t1");
    expect(agent.connectedThreadIds).toEqual(["t1"]);
  });

  it("sends a message only after the thread has been restored", async () => {
    const agent = new ThreadedAgent({ t1: [text("a", "from t1")] });
    const release = agent.holdConnect();
    renderChat(agent, "t1");
    await waitFor(() => expect(agent.connectedThreadIds).toEqual(["t1"]));

    let sent: Promise<void> | undefined;
    act(() => {
      sent = chat!.submitMessage("hello");
    });
    // The connect is still loading, so the send waits for it.
    await Promise.resolve();
    expect(agent.runs).toEqual([]);

    await act(async () => {
      release();
      await sent;
    });

    expect(agent.runs).toEqual([
      { threadId: "t1", messages: ["from t1", "hello"] },
    ]);
  });
  it("leaves the agent's run running when the chat unmounts after the thread loaded", async () => {
    const agent = new ThreadedAgent({ t1: [text("a", "from t1")] });
    const { unmount } = renderChat(agent, "t1");
    await waitFor(() => expect(transcript()).toEqual(["from t1"]));
    const finishRun = agent.holdRun();
    let sent: Promise<void> | undefined;
    act(() => {
      sent = chat!.submitMessage("hello");
    });
    await waitFor(() => expect(agent.runs).toHaveLength(1));
    // Core detaches the previous run itself before a connect or a run; count
    // only what the chat's cleanup does.
    const detach = vi.spyOn(agent, "detachActiveRun");

    unmount();
    await act(async () => {});

    // The connect had settled, so the run in flight is not the connect's
    // own: the reply the user asked for keeps streaming.
    expect(detach).not.toHaveBeenCalled();
    finishRun();
    await sent;
    expect(agent.messages.map((m) => String(m.content))).toEqual([
      "from t1",
      "hello",
      "reply",
    ]);
  });

  it("keeps the messages of an agent that cannot connect, and sends on its thread", async () => {
    // An agent without connect: a connect would only empty it.
    const agent = new (class extends SeededAgent {
      readonly runs: string[] = [];
      override async runAgent(): Promise<RunAgentResult> {
        this.runs.push(this.threadId);
        return EMPTY_RESULT;
      }
    })();
    agent.setMessages([text("a", "kept")]);
    renderChat(agent as unknown as ThreadedAgent, "t1");

    await act(async () => {
      await chat!.submitMessage("hello");
    });

    expect(transcript()).toEqual(["kept", "hello"]);
    expect(agent.runs).toEqual(["t1"]);
  });
});
