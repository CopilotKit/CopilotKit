import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import type { Ref } from "vue";
import type { AbstractAgent, Message, RunAgentInput } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import type { RunErrorEvent } from "@ag-ui/client";
import { useAgent, UseAgentUpdate } from "../use-agent";
import { mountWithProvider } from "../../__tests__/utils/mount";

class NotifyingAgent implements Partial<AbstractAgent> {
  agentId: string;
  threadId?: string;
  isRunning = false;
  messages: Message[] = [];
  state: Record<string, unknown> = {};
  private readonly handlers = new Set<
    Parameters<AbstractAgent["subscribe"]>[0]
  >();

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  get subscriberCount() {
    return this.handlers.size;
  }

  clone() {
    return this as AbstractAgent;
  }

  run(input: RunAgentInput): never {
    void input;
    throw new Error("NotifyingAgent.run() should not be called in this test");
  }

  subscribe(handler: Parameters<AbstractAgent["subscribe"]>[0]) {
    this.handlers.add(handler);
    return {
      unsubscribe: () => {
        this.handlers.delete(handler);
      },
    };
  }

  setMessages(messages: Message[]) {
    this.messages = messages;
  }

  notifyMessagesChanged() {
    for (const handler of this.handlers) {
      handler.onMessagesChanged?.({
        agent: this as AbstractAgent,
        messages: this.messages,
        state: this.state,
      });
    }
  }

  notifyStateChanged() {
    for (const handler of this.handlers) {
      handler.onStateChanged?.({
        agent: this as AbstractAgent,
        messages: this.messages,
        state: this.state,
      });
    }
  }

  notifyRunInitialized() {
    const input: RunAgentInput = {
      threadId: "t-1",
      runId: "r-1",
      state: {},
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {},
    };
    for (const handler of this.handlers) {
      handler.onRunInitialized?.({
        agent: this as AbstractAgent,
        messages: this.messages,
        state: this.state,
        input,
      });
    }
  }

  notifyRunErrorEvent(
    message = "run failed",
    code: string | number | undefined = undefined,
  ) {
    const input: RunAgentInput = {
      threadId: "t-1",
      runId: "r-1",
      state: {},
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {},
    };
    const event: RunErrorEvent = {
      type: EventType.RUN_ERROR,
      message,
      ...(code !== undefined ? { code } : {}),
    } as RunErrorEvent;
    for (const handler of this.handlers) {
      handler.onRunErrorEvent?.({
        agent: this as AbstractAgent,
        messages: this.messages,
        state: this.state,
        input,
        event,
      });
    }
  }
}

function userMsg(id: string, content = `msg-${id}`): Message {
  return { id, role: "user", content } as Message;
}

function assistantMsg(id: string, content = `msg-${id}`): Message {
  return { id, role: "assistant", content } as Message;
}

function createMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, idx) =>
    idx % 2 === 0
      ? userMsg(String(idx + 1), `tok${idx + 1}`)
      : assistantMsg(String(idx + 1), `tok${idx + 1}`),
  );
}

async function flushVue() {
  await Promise.resolve();
  await nextTick();
}

function mountHookComponent(options: {
  agent: NotifyingAgent;
  updates?: UseAgentUpdate[];
  throttleMs?: number | Ref<number | undefined>;
  defaultThrottleMs?: number | undefined;
  renderCount?: { current: number };
}) {
  const {
    agent,
    updates = [UseAgentUpdate.OnMessagesChanged],
    throttleMs,
    defaultThrottleMs,
    renderCount,
  } = options;

  const Child = defineComponent({
    setup() {
      const { agent: agentRef } = useAgent({
        agentId: "test-agent",
        updates,
        throttleMs,
      });
      return () => {
        if (renderCount) renderCount.current += 1;
        return h("div", [
          h("span", { "data-testid": "count" }, agentRef.value.messages.length),
          h(
            "span",
            { "data-testid": "state" },
            JSON.stringify(agentRef.value.state),
          ),
        ]);
      };
    },
  });

  return mountWithProvider(() => h(Child), {
    agents__unsafe_dev_only: { "test-agent": agent as AbstractAgent },
    defaultThrottleMs,
  });
}

describe("useAgent throttleMs", () => {
  let agent: NotifyingAgent;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    agent = new NotifyingAgent("test-agent");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("without throttleMs, component reflects latest messages after notification", async () => {
    const { wrapper } = mountHookComponent({ agent });
    expect(wrapper.find("[data-testid=count]").text()).toBe("0");
    agent.setMessages([userMsg("1", "hello")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");
  });

  it("with throttleMs: 0 (explicit), behaves identically to omitting throttleMs", async () => {
    const { wrapper } = mountHookComponent({ agent, throttleMs: 0 });
    agent.setMessages([userMsg("1", "hello")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");
    agent.setMessages([userMsg("1", "hello"), assistantMsg("2", "world")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("2");
  });

  it("with throttleMs, first notification fires immediately (leading edge)", async () => {
    const { wrapper } = mountHookComponent({ agent, throttleMs: 100 });
    agent.setMessages([userMsg("1", "hello")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");
  });

  it("with throttleMs, second notification within window is deferred until trailing edge", async () => {
    const { wrapper } = mountHookComponent({ agent, throttleMs: 100 });
    agent.setMessages([userMsg("1", "a")]);
    agent.notifyMessagesChanged();
    await flushVue();
    vi.advanceTimersByTime(10);
    agent.setMessages([userMsg("1", "a"), assistantMsg("2", "b")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");
    vi.advanceTimersByTime(100);
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("2");
  });

  it("with throttleMs, rapid burst of many notifications results in exactly 2 renders (leading + trailing)", async () => {
    const { wrapper } = mountHookComponent({ agent, throttleMs: 100 });
    agent.setMessages([userMsg("1", "tok1")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");
    for (let i = 2; i <= 11; i += 1) {
      vi.advanceTimersByTime(1);
      agent.setMessages(createMessages(i));
      agent.notifyMessagesChanged();
      await flushVue();
    }
    vi.advanceTimersByTime(100);
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("11");
  });

  it("with throttleMs, new notification after trailing edge fires immediately (new cycle)", async () => {
    const { wrapper } = mountHookComponent({ agent, throttleMs: 100 });
    agent.setMessages([userMsg("1", "a")]);
    agent.notifyMessagesChanged();
    await flushVue();
    vi.advanceTimersByTime(10);
    agent.setMessages([userMsg("1", "a"), assistantMsg("2", "b")]);
    agent.notifyMessagesChanged();
    vi.advanceTimersByTime(100);
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("2");
    vi.advanceTimersByTime(200);
    agent.setMessages([
      userMsg("1", "a"),
      assistantMsg("2", "b"),
      userMsg("3", "c"),
    ]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("3");
  });

  it("with throttleMs, onStateChanged is also throttled (shared window)", async () => {
    // Parity with React: `subscribeToAgentWithOptions` now shares a single
    // throttle window across `onMessagesChanged` and `onStateChanged`, so a
    // state change fired inside the message throttle window is deferred to
    // the trailing edge instead of rendering immediately.
    const { wrapper } = mountHookComponent({
      agent,
      throttleMs: 100,
      updates: [
        UseAgentUpdate.OnMessagesChanged,
        UseAgentUpdate.OnStateChanged,
      ],
    });

    // Leading edge via messages.
    agent.setMessages([userMsg("1", "a")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");

    // State change inside the throttle window — should be deferred.
    vi.advanceTimersByTime(10);
    agent.state = { count: 42 };
    agent.notifyStateChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=state]").text()).toBe("{}");

    // Trailing edge fires after the window expires.
    vi.advanceTimersByTime(100);
    await flushVue();
    expect(wrapper.find("[data-testid=state]").text()).toBe('{"count":42}');
  });

  it("with throttleMs and only OnStateChanged subscribed, first state fires on leading edge", async () => {
    const { wrapper } = mountHookComponent({
      agent,
      throttleMs: 100,
      updates: [UseAgentUpdate.OnStateChanged],
    });

    // First onStateChanged fires immediately (leading edge).
    agent.state = { value: "test" };
    agent.notifyStateChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=state]").text()).toBe('{"value":"test"}');

    // No onMessagesChanged subscription exists — notification is a no-op.
    agent.setMessages([userMsg("1", "a")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=state]").text()).toBe('{"value":"test"}');
  });

  it("with throttleMs, onRunErrorEvent fires immediately (bypasses shared throttle window)", async () => {
    // Run lifecycle callbacks — including `onRunErrorEvent` — always fire
    // immediately in core's `subscribeToAgentWithOptions`, regardless of the
    // active throttle window for messages/state.
    const { wrapper } = mountHookComponent({
      agent,
      throttleMs: 100,
      updates: [
        UseAgentUpdate.OnMessagesChanged,
        UseAgentUpdate.OnStateChanged,
        UseAgentUpdate.OnRunStatusChanged,
      ],
    });

    // Open the throttle window with a messages change.
    agent.setMessages([userMsg("1", "a")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");

    // Inside the window, a state change is deferred…
    vi.advanceTimersByTime(10);
    agent.state = { count: 1 };
    agent.notifyStateChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=state]").text()).toBe("{}");

    // …but a RUN_ERROR event triggers an immediate re-render. We update
    // state first so the next render proves the error path flushed.
    agent.state = { count: 2 };
    agent.notifyRunErrorEvent();
    await flushVue();
    expect(wrapper.find("[data-testid=state]").text()).toBe('{"count":2}');
  });

  it("with throttleMs, pending trailing timer does not fire after unmount", async () => {
    const renderCount = { current: 0 };
    const { wrapper } = mountHookComponent({
      agent,
      throttleMs: 100,
      renderCount,
    });
    agent.setMessages([userMsg("1", "a")]);
    agent.notifyMessagesChanged();
    await flushVue();
    vi.advanceTimersByTime(10);
    agent.setMessages([userMsg("1", "a"), assistantMsg("2", "b")]);
    agent.notifyMessagesChanged();
    await flushVue();
    const beforeUnmount = renderCount.current;
    wrapper.unmount();
    vi.advanceTimersByTime(100);
    await flushVue();
    expect(renderCount.current).toBe(beforeUnmount);
  });

  it("with throttleMs and updates excluding OnMessagesChanged, throttle is a no-op", async () => {
    const { wrapper } = mountHookComponent({
      agent,
      throttleMs: 100,
      updates: [UseAgentUpdate.OnStateChanged],
    });
    agent.state = { value: "test" };
    agent.notifyStateChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=state]").text()).toBe('{"value":"test"}');
    agent.setMessages([userMsg("1", "a")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=state]").text()).toBe('{"value":"test"}');
  });

  it.each([
    { label: "NaN", value: Number.NaN },
    { label: "Infinity", value: Number.POSITIVE_INFINITY },
    { label: "-1", value: -1 },
    { label: "-Infinity", value: Number.NEGATIVE_INFINITY },
  ])(
    "with invalid throttleMs ($label), falls back to unthrottled and warns",
    async ({ value }) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { wrapper } = mountHookComponent({ agent, throttleMs: value });
      // Source of the warning is now core's `subscribeToAgentWithOptions`,
      // which calls `console.error(message, error)` via `logAndEmitError`.
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "throttleMs must be a non-negative finite number",
        ),
        expect.any(Error),
      );
      agent.setMessages([userMsg("1", "a")]);
      agent.notifyMessagesChanged();
      await flushVue();
      expect(wrapper.find("[data-testid=count]").text()).toBe("1");
      agent.setMessages([userMsg("1", "a"), assistantMsg("2", "b")]);
      agent.notifyMessagesChanged();
      await flushVue();
      expect(wrapper.find("[data-testid=count]").text()).toBe("2");
    },
  );

  it("trailing-edge render reflects the latest messages, not stale data", async () => {
    const { wrapper } = mountHookComponent({ agent, throttleMs: 100 });
    agent.setMessages([userMsg("1", "A")]);
    agent.notifyMessagesChanged();
    await flushVue();
    vi.advanceTimersByTime(20);
    agent.setMessages([userMsg("1", "A"), assistantMsg("2", "B")]);
    agent.notifyMessagesChanged();
    vi.advanceTimersByTime(20);
    agent.setMessages([
      userMsg("1", "A"),
      assistantMsg("2", "B"),
      assistantMsg("3", "C"),
    ]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");
    vi.advanceTimersByTime(100);
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("3");
  });

  it("trailing edge fires at exactly throttleMs after the leading edge", async () => {
    const { wrapper } = mountHookComponent({ agent, throttleMs: 100 });
    agent.setMessages([userMsg("1", "a")]);
    agent.notifyMessagesChanged();
    await flushVue();
    vi.advanceTimersByTime(40);
    agent.setMessages([userMsg("1", "a"), assistantMsg("2", "b")]);
    agent.notifyMessagesChanged();
    vi.advanceTimersByTime(59);
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");
    vi.advanceTimersByTime(1);
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("2");
  });

  it("changing throttleMs cleans up pending timers from the previous configuration", async () => {
    const throttleRef = ref<number | undefined>(200);
    const { wrapper } = mountHookComponent({ agent, throttleMs: throttleRef });
    agent.setMessages([userMsg("1", "a")]);
    agent.notifyMessagesChanged();
    await flushVue();
    vi.advanceTimersByTime(50);
    agent.setMessages([userMsg("1", "a"), assistantMsg("2", "b")]);
    agent.notifyMessagesChanged();
    await flushVue();
    throttleRef.value = 50;
    await flushVue();
    agent.setMessages([
      userMsg("1", "a"),
      assistantMsg("2", "b"),
      userMsg("3", "c"),
    ]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("3");
    vi.advanceTimersByTime(200);
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("3");
  });

  it("notification immediately after trailing edge is throttled (trailing restarts the window)", async () => {
    const { wrapper } = mountHookComponent({ agent, throttleMs: 100 });
    agent.setMessages([userMsg("1", "a")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");
    vi.advanceTimersByTime(10);
    agent.setMessages([userMsg("1", "a"), assistantMsg("2", "b")]);
    agent.notifyMessagesChanged();
    vi.advanceTimersByTime(90);
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("2");
    vi.advanceTimersByTime(1);
    agent.setMessages([
      userMsg("1", "a"),
      assistantMsg("2", "b"),
      userMsg("3", "c"),
    ]);
    agent.notifyMessagesChanged();
    await flushVue();
    vi.advanceTimersByTime(99);
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("3");
  });

  it("cleans up all subscriptions after unmount", async () => {
    const { wrapper } = mountHookComponent({
      agent,
      throttleMs: 100,
      updates: [
        UseAgentUpdate.OnMessagesChanged,
        UseAgentUpdate.OnStateChanged,
      ],
    });
    expect(agent.subscriberCount).toBeGreaterThan(0);
    wrapper.unmount();
    await flushVue();
    const countAfterUnmount = agent.subscriberCount;
    agent.setMessages([userMsg("1", "post-unmount")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(agent.subscriberCount).toBe(countAfterUnmount);
  });

  it("single notification within window does not trigger a trailing re-render", async () => {
    const renderCount = { current: 0 };
    mountHookComponent({ agent, throttleMs: 100, renderCount });
    const afterMount = renderCount.current;
    agent.setMessages([userMsg("1", "a")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(renderCount.current).toBe(afterMount + 1);
    vi.advanceTimersByTime(200);
    await flushVue();
    expect(renderCount.current).toBe(afterMount + 1);
  });

  it("with throttleMs, onRunInitialized still fires immediately during throttle window", async () => {
    const { wrapper } = mountHookComponent({
      agent,
      throttleMs: 100,
      updates: [
        UseAgentUpdate.OnMessagesChanged,
        UseAgentUpdate.OnRunStatusChanged,
      ],
    });
    agent.setMessages([userMsg("1", "a")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");
    vi.advanceTimersByTime(10);
    agent.notifyRunInitialized();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");
  });

  it("changing throttleMs from positive to 0 disables throttling immediately", async () => {
    const throttleRef = ref<number | undefined>(200);
    const { wrapper } = mountHookComponent({ agent, throttleMs: throttleRef });
    agent.setMessages([userMsg("1", "a")]);
    agent.notifyMessagesChanged();
    await flushVue();
    vi.advanceTimersByTime(50);
    agent.setMessages([userMsg("1", "a"), assistantMsg("2", "b")]);
    agent.notifyMessagesChanged();
    await flushVue();
    throttleRef.value = 0;
    await flushVue();
    agent.setMessages([
      userMsg("1", "a"),
      assistantMsg("2", "b"),
      userMsg("3", "c"),
    ]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("3");
    agent.setMessages([
      userMsg("1", "a"),
      assistantMsg("2", "b"),
      userMsg("3", "c"),
      assistantMsg("4", "d"),
    ]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("4");
  });
});

describe("useAgent defaultThrottleMs from provider", () => {
  let agent: NotifyingAgent;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    agent = new NotifyingAgent("test-agent");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses provider defaultThrottleMs when no explicit throttleMs is passed", async () => {
    const { wrapper } = mountHookComponent({ agent, defaultThrottleMs: 100 });
    agent.setMessages([userMsg("1", "hello")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");
    vi.advanceTimersByTime(10);
    agent.setMessages([userMsg("1", "hello"), assistantMsg("2", "world")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");
    vi.advanceTimersByTime(100);
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("2");
  });

  it("explicit throttleMs overrides provider defaultThrottleMs", async () => {
    const { wrapper } = mountHookComponent({
      agent,
      defaultThrottleMs: 5000,
      throttleMs: 100,
    });
    agent.setMessages([userMsg("1", "hello")]);
    agent.notifyMessagesChanged();
    await flushVue();
    vi.advanceTimersByTime(10);
    agent.setMessages([userMsg("1", "hello"), assistantMsg("2", "world")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");
    vi.advanceTimersByTime(100);
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("2");
  });

  it("without provider defaultThrottleMs or explicit throttleMs, behaves unthrottled", async () => {
    const { wrapper } = mountHookComponent({ agent });
    agent.setMessages([userMsg("1", "hello")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");
    agent.setMessages([userMsg("1", "hello"), assistantMsg("2", "world")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("2");
  });

  it("explicit throttleMs: 0 overrides non-zero provider defaultThrottleMs (opt-out)", async () => {
    const { wrapper } = mountHookComponent({
      agent,
      defaultThrottleMs: 500,
      throttleMs: 0,
    });
    agent.setMessages([userMsg("1", "hello")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");
    agent.setMessages([userMsg("1", "hello"), assistantMsg("2", "world")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("2");
  });

  it.each([
    { label: "NaN", value: Number.NaN },
    { label: "Infinity", value: Number.POSITIVE_INFINITY },
    { label: "-1", value: -1 },
    { label: "-Infinity", value: Number.NEGATIVE_INFINITY },
  ])(
    "with invalid provider defaultThrottleMs ($label), falls back to unthrottled and warns",
    async ({ value }) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { wrapper } = mountHookComponent({
        agent,
        defaultThrottleMs: value,
      });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("CopilotKitProvider: defaultThrottleMs"),
      );
      agent.setMessages([userMsg("1", "a")]);
      agent.notifyMessagesChanged();
      await flushVue();
      expect(wrapper.find("[data-testid=count]").text()).toBe("1");
      agent.setMessages([userMsg("1", "a"), assistantMsg("2", "b")]);
      agent.notifyMessagesChanged();
      await flushVue();
      expect(wrapper.find("[data-testid=count]").text()).toBe("2");
    },
  );

  it("dynamically changing provider defaultThrottleMs updates throttle behavior", async () => {
    const mounted = mountHookComponent({ agent, defaultThrottleMs: 200 });
    const { wrapper } = mounted;
    agent.setMessages([userMsg("1", "hello")]);
    agent.notifyMessagesChanged();
    await flushVue();
    vi.advanceTimersByTime(10);
    agent.setMessages([userMsg("1", "hello"), assistantMsg("2", "world")]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");
    vi.advanceTimersByTime(200);
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("2");
    await wrapper.setProps({ defaultThrottleMs: 50 });
    await flushVue();
    agent.setMessages([
      userMsg("1", "hello"),
      assistantMsg("2", "world"),
      userMsg("3", "new"),
    ]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("3");
    vi.advanceTimersByTime(10);
    agent.setMessages([
      userMsg("1", "hello"),
      assistantMsg("2", "world"),
      userMsg("3", "new"),
      assistantMsg("4", "reply"),
    ]);
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("3");
    vi.advanceTimersByTime(50);
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("4");
  });
});
