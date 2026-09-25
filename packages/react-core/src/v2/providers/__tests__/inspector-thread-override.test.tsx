import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emitInspectorStopViewing,
  emitInspectorViewThread,
  onInspectorActiveThread,
  onInspectorViewThreadResult,
} from "@copilotkit/core";
import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkit/shared";
import { MockStepwiseAgent } from "../../__tests__/utils/test-helpers";
import { CopilotChat } from "../../components/chat/CopilotChat";
import { CopilotKitProvider } from "../CopilotKitProvider";
import {
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "../CopilotChatConfigurationProvider";

class TrackingAgent extends MockStepwiseAgent {
  connectCalls: string[] = [];
  failThreadId: string | null = null;

  clone(): this {
    const cloned = super.clone();
    const registry = this;
    Object.defineProperties(cloned, {
      threadId: {
        get: () => registry.threadId,
        set: (value: string) => {
          registry.threadId = value;
        },
        configurable: true,
      },
      connectCalls: {
        get: () => registry.connectCalls,
        configurable: true,
      },
      failThreadId: {
        get: () => registry.failThreadId,
        set: (value: string | null) => {
          registry.failThreadId = value;
        },
        configurable: true,
      },
    });
    return cloned;
  }

  async connectAgent(
    _params: unknown,
    _subscriber: unknown,
  ): Promise<{ result: unknown; newMessages: [] }> {
    this.connectCalls.push(this.threadId ?? "");
    if (this.threadId === this.failThreadId) {
      throw new Error("connect failed");
    }
    return { result: undefined, newMessages: [] };
  }
}

function ThreadControls() {
  const configuration = useCopilotChatConfiguration();
  return (
    <>
      <button onClick={() => configuration?.setActiveThreadId("app-picked")}>
        select
      </button>
      <button onClick={() => configuration?.startNewThread()}>new</button>
    </>
  );
}

function renderChat(
  agent: TrackingAgent,
  options: { threadId?: string; withControls?: boolean } = {},
) {
  agent.agentId = DEFAULT_AGENT_ID;
  const chat = <CopilotChat threadId={options.threadId} />;
  return render(
    <CopilotKitProvider agents__unsafe_dev_only={{ [DEFAULT_AGENT_ID]: agent }}>
      {options.withControls ? (
        <CopilotChatConfigurationProvider agentId={DEFAULT_AGENT_ID}>
          {chat}
          <ThreadControls />
        </CopilotChatConfigurationProvider>
      ) : (
        chat
      )}
    </CopilotKitProvider>,
  );
}

function viewRequest(requestId: string, threadId = "saved-thread") {
  return emitInspectorViewThread({
    requestId,
    threadId,
    agentId: DEFAULT_AGENT_ID,
  });
}

describe("inspector thread override", () => {
  const cleanups: Array<() => void> = [];
  let uuidSequence = 0;

  beforeEach(() => {
    cleanups.length = 0;
    vi.mocked(randomUUID).mockImplementation(
      () => `inspector-thread-${++uuidSequence}`,
    );
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.mocked(randomUUID).mockImplementation(() => "mock-thread-id");
  });

  it("switches a pinned threadId when view-thread matches the agent", async () => {
    const agent = new TrackingAgent();
    renderChat(agent, { threadId: "pinned-thread" });
    await waitFor(() => expect(agent.threadId).toBe("pinned-thread"));

    act(() => expect(viewRequest("request-1")).toBe(true));

    await waitFor(() => expect(agent.threadId).toBe("saved-thread"));
    expect(agent.connectCalls).toContain("saved-thread");
  });

  it("ignores view-thread for a different agent", async () => {
    const agent = new TrackingAgent();
    renderChat(agent, { threadId: "pinned-thread" });
    await waitFor(() => expect(agent.threadId).toBe("pinned-thread"));

    act(() => {
      expect(
        emitInspectorViewThread({
          requestId: "request-2",
          threadId: "other-thread",
          agentId: "other-agent",
        }),
      ).toBe(false);
    });

    expect(agent.threadId).toBe("pinned-thread");
  });

  it("restores the previous thread on stop-viewing", async () => {
    const agent = new TrackingAgent();
    renderChat(agent, { threadId: "pinned-thread" });
    act(() => void viewRequest("request-3"));
    await waitFor(() => expect(agent.threadId).toBe("saved-thread"));

    act(() =>
      emitInspectorStopViewing({
        requestId: "request-3",
        agentId: DEFAULT_AGENT_ID,
      }),
    );

    await waitFor(() => expect(agent.threadId).toBe("pinned-thread"));
  });

  it("keeps the original previous thread after a second view-thread", async () => {
    const agent = new TrackingAgent();
    renderChat(agent, { threadId: "pinned-thread" });
    act(() => void viewRequest("request-4a", "first-saved"));
    await waitFor(() => expect(agent.threadId).toBe("first-saved"));
    act(() => void viewRequest("request-4b", "second-saved"));
    await waitFor(() => expect(agent.threadId).toBe("second-saved"));

    act(() =>
      emitInspectorStopViewing({
        requestId: "request-4b",
        agentId: DEFAULT_AGENT_ID,
      }),
    );

    await waitFor(() => expect(agent.threadId).toBe("pinned-thread"));
  });

  it("ends the override when the app picks a thread", async () => {
    const agent = new TrackingAgent();
    renderChat(agent, { withControls: true });
    act(() => void viewRequest("request-5"));
    await waitFor(() => expect(agent.threadId).toBe("saved-thread"));

    fireEvent.click(screen.getByText("select"));

    await waitFor(() => expect(agent.threadId).toBe("app-picked"));
  });

  it("ends the override when the app starts a new thread", async () => {
    const agent = new TrackingAgent();
    renderChat(agent, { withControls: true });
    act(() => void viewRequest("request-6"));
    await waitFor(() => expect(agent.threadId).toBe("saved-thread"));

    fireEvent.click(screen.getByText("new"));

    await waitFor(() => expect(agent.threadId).not.toBe("saved-thread"));
  });

  it("rolls back when connect fails", async () => {
    const agent = new TrackingAgent();
    agent.failThreadId = "saved-thread";
    renderChat(agent, { threadId: "pinned-thread" });
    const results: boolean[] = [];
    cleanups.push(
      onInspectorViewThreadResult((payload) => {
        if (payload.requestId === "request-7") results.push(payload.ok);
      }),
    );

    act(() => void viewRequest("request-7"));

    await waitFor(() => expect(results).toContain(false));
    await waitFor(() => expect(agent.threadId).toBe("pinned-thread"));
  });

  it("emits applied result and active-thread on view", async () => {
    const agent = new TrackingAgent();
    const results: boolean[] = [];
    const activeSources: string[] = [];
    cleanups.push(
      onInspectorViewThreadResult((payload) => results.push(payload.ok)),
      onInspectorActiveThread((payload) => activeSources.push(payload.source)),
    );
    renderChat(agent, { threadId: "pinned-thread" });

    act(() => expect(viewRequest("request-8")).toBe(true));

    await waitFor(() => expect(agent.threadId).toBe("saved-thread"));
    expect(results).toContain(true);
    expect(activeSources).toContain("override");
  });
});
