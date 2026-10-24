import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/vue";
import { defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentHistoryReplayError,
  emitInspectorStopViewing,
  emitInspectorViewThread,
  onInspectorActiveThread,
  onInspectorViewThreadResult,
} from "@copilotkit/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { MockStepwiseAgent } from "../../__tests__/utils/test-helpers";
import CopilotChat from "../../components/chat/CopilotChat.vue";
import CopilotKitProvider from "../CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../CopilotChatConfigurationProvider.vue";
import { useCopilotChatConfiguration } from "../useCopilotChatConfiguration";

class TrackingAgent extends MockStepwiseAgent {
  connectCalls: string[] = [];
  failThreadId: string | null = null;

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

const ThreadControls = defineComponent({
  setup() {
    const configuration = useCopilotChatConfiguration();
    return { configuration };
  },
  template: `
    <button @click="configuration?.setActiveThreadId('app-picked')">select</button>
    <button @click="configuration?.startNewThread()">new</button>
  `,
});

function renderChat(
  agent: TrackingAgent,
  options: {
    threadId?: string;
    withControls?: boolean;
    onError?: (event: unknown) => void;
  } = {},
) {
  agent.agentId = DEFAULT_AGENT_ID;
  const Root = defineComponent({
    components: {
      CopilotChat,
      CopilotChatConfigurationProvider,
      CopilotKitProvider,
      ThreadControls,
    },
    setup() {
      return {
        agents: { [DEFAULT_AGENT_ID]: agent },
        threadId: options.threadId,
        withControls: options.withControls ?? false,
        onError: options.onError,
      };
    },
    template: `
      <CopilotKitProvider :agents__unsafe_dev_only="agents">
        <CopilotChatConfigurationProvider v-if="withControls" :agent-id="'default'">
          <CopilotChat :thread-id="threadId" :on-error="onError" />
          <ThreadControls />
        </CopilotChatConfigurationProvider>
        <CopilotChat v-else :thread-id="threadId" :on-error="onError" />
      </CopilotKitProvider>
    `,
  });
  return render(Root);
}

function viewRequest(requestId: string, threadId = "saved-thread") {
  return emitInspectorViewThread({
    requestId,
    threadId,
    agentId: DEFAULT_AGENT_ID,
  });
}

it("rolls back when typed history replay fails", async () => {
  class HistoryFailureAgent extends TrackingAgent {
    async connectAgent(params: unknown, subscriber: unknown) {
      if (this.threadId === "saved-thread")
        throw new AgentHistoryReplayError("history_read_timeout");
      return super.connectAgent(params, subscriber);
    }
  }
  const agent = new HistoryFailureAgent();
  const results: boolean[] = [];
  const unsubscribe = onInspectorViewThreadResult((payload) => {
    if (payload.requestId === "history-failure") results.push(payload.ok);
  });
  try {
    renderChat(agent, { threadId: "pinned-thread" });
    await waitFor(() => expect(agent.threadId).toBe("pinned-thread"));
    viewRequest("history-failure");
    await waitFor(() => expect(results).toEqual([true, false]));
    await waitFor(() => expect(agent.threadId).toBe("pinned-thread"));
  } finally {
    unsubscribe();
    cleanup();
  }
});

it("keeps the current override when another thread's history replay fails", async () => {
  let rejectHistory: (error: Error) => void = () => {
    throw new Error("History not connected");
  };
  class DelayedHistoryFailureAgent extends TrackingAgent {
    async connectAgent(params: unknown, subscriber: unknown) {
      if (this.threadId === "failed-thread") {
        this.connectCalls.push(this.threadId);
        return new Promise<{ result: unknown; newMessages: [] }>(
          (_resolve, reject) => {
            rejectHistory = reject;
          },
        );
      }
      return super.connectAgent(params, subscriber);
    }
  }
  const agent = new DelayedHistoryFailureAgent();
  const onError = vi.fn();
  const failures: string[] = [];
  const unsubscribe = onInspectorViewThreadResult((payload) => {
    if (!payload.ok) failures.push(payload.requestId);
  });
  try {
    renderChat(agent, { threadId: "pinned-thread", onError });
    await waitFor(() => expect(agent.threadId).toBe("pinned-thread"));
    viewRequest("old-history", "failed-thread");
    await waitFor(() => expect(agent.connectCalls).toContain("failed-thread"));
    viewRequest("current-history");
    await waitFor(() => expect(agent.threadId).toBe("saved-thread"));
    rejectHistory(new AgentHistoryReplayError("history_read_timeout"));
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({ threadId: "failed-thread" }),
        }),
      ),
    );
    expect(failures).toEqual([]);
    expect(agent.threadId).toBe("saved-thread");
  } finally {
    unsubscribe();
    cleanup();
  }
});

describe("inspector thread override", () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    cleanups.length = 0;
  });

  afterEach(() => {
    for (const unsubscribe of cleanups.splice(0)) unsubscribe();
    cleanup();
  });

  it("switches a pinned threadId when view-thread matches the agent", async () => {
    const agent = new TrackingAgent();
    renderChat(agent, { threadId: "pinned-thread" });
    await waitFor(() => expect(agent.threadId).toBe("pinned-thread"));

    expect(viewRequest("request-1")).toBe(true);

    await waitFor(() => expect(agent.threadId).toBe("saved-thread"));
    expect(agent.connectCalls).toContain("saved-thread");
  });

  it("ignores view-thread for a different agent", async () => {
    const agent = new TrackingAgent();
    renderChat(agent, { threadId: "pinned-thread" });
    await waitFor(() => expect(agent.threadId).toBe("pinned-thread"));

    expect(
      emitInspectorViewThread({
        requestId: "request-2",
        threadId: "other-thread",
        agentId: "other-agent",
      }),
    ).toBe(false);

    expect(agent.threadId).toBe("pinned-thread");
  });

  it("restores the previous thread on stop-viewing", async () => {
    const agent = new TrackingAgent();
    renderChat(agent, { threadId: "pinned-thread" });
    viewRequest("request-3");
    await waitFor(() => expect(agent.threadId).toBe("saved-thread"));

    emitInspectorStopViewing({
      requestId: "request-3",
      agentId: DEFAULT_AGENT_ID,
    });

    await waitFor(() => expect(agent.threadId).toBe("pinned-thread"));
  });

  it("keeps the original previous thread after a second view-thread", async () => {
    const agent = new TrackingAgent();
    renderChat(agent, { threadId: "pinned-thread" });
    viewRequest("request-4a", "first-saved");
    await waitFor(() => expect(agent.threadId).toBe("first-saved"));
    viewRequest("request-4b", "second-saved");
    await waitFor(() => expect(agent.threadId).toBe("second-saved"));

    emitInspectorStopViewing({
      requestId: "request-4b",
      agentId: DEFAULT_AGENT_ID,
    });

    await waitFor(() => expect(agent.threadId).toBe("pinned-thread"));
  });

  it("ends the override when the app picks a thread", async () => {
    const agent = new TrackingAgent();
    renderChat(agent, { withControls: true });
    viewRequest("request-5");
    await waitFor(() => expect(agent.threadId).toBe("saved-thread"));

    await fireEvent.click(screen.getByText("select"));

    await waitFor(() => expect(agent.threadId).toBe("app-picked"));
  });

  it("ends the override when the app starts a new thread", async () => {
    const agent = new TrackingAgent();
    renderChat(agent, { withControls: true });
    viewRequest("request-6");
    await waitFor(() => expect(agent.threadId).toBe("saved-thread"));

    await fireEvent.click(screen.getByText("new"));

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

    viewRequest("request-7");

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

    expect(viewRequest("request-8")).toBe(true);

    await waitFor(() => expect(agent.threadId).toBe("saved-thread"));
    expect(results).toContain(true);
    expect(activeSources).toContain("override");
  });
});
