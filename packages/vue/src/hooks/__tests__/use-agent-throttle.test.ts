import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import type { AbstractAgent, Message, RunAgentInput } from "@ag-ui/client";
import { useAgent } from "../use-agent";
import { mountWithProvider } from "../../__tests__/utils/mount";

class NotifyingAgent implements Partial<AbstractAgent> {
  agentId: string;
  threadId?: string;
  isRunning = false;
  messages: Message[] = [];
  state: Record<string, unknown> = {};
  private handlers = new Set<Parameters<AbstractAgent["subscribe"]>[0]>();

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  clone() {
    return this as AbstractAgent;
  }

  run(_input: RunAgentInput): any {
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
        agent: this as unknown as AbstractAgent,
        messages: this.messages,
        state: this.state,
      });
    }
  }
}

function buildMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: String(idx + 1),
    role: idx % 2 === 0 ? "user" : "assistant",
    content: `msg-${idx + 1}`,
  })) as Message[];
}

async function flushVue() {
  await Promise.resolve();
  await nextTick();
}

describe("useAgent throttleMs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("uses provider defaultThrottleMs when hook throttleMs is omitted", async () => {
    const agent = new NotifyingAgent("test-agent");
    const Child = defineComponent({
      setup() {
        const { agent } = useAgent({ agentId: "test-agent" });
        return () =>
          h("span", { "data-testid": "count" }, agent.value.messages.length);
      },
    });

    const { wrapper } = mountWithProvider(() => h(Child), {
      agents__unsafe_dev_only: {
        "test-agent": agent as unknown as AbstractAgent,
      },
      defaultThrottleMs: 100,
    });

    agent.setMessages(buildMessages(1));
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");

    vi.advanceTimersByTime(10);
    agent.setMessages(buildMessages(2));
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");

    vi.advanceTimersByTime(100);
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("2");
  });

  it("hook throttleMs overrides provider defaultThrottleMs", async () => {
    const agent = new NotifyingAgent("test-agent");
    const Child = defineComponent({
      setup() {
        const { agent } = useAgent({ agentId: "test-agent", throttleMs: 0 });
        return () =>
          h("span", { "data-testid": "count" }, agent.value.messages.length);
      },
    });

    const { wrapper } = mountWithProvider(() => h(Child), {
      agents__unsafe_dev_only: {
        "test-agent": agent as unknown as AbstractAgent,
      },
      defaultThrottleMs: 500,
    });

    agent.setMessages(buildMessages(1));
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");

    agent.setMessages(buildMessages(2));
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("2");
  });

  it("invalid provider defaultThrottleMs warns and falls back to unthrottled", async () => {
    const agent = new NotifyingAgent("test-agent");
    const Child = defineComponent({
      setup() {
        const { agent } = useAgent({ agentId: "test-agent" });
        return () =>
          h("span", { "data-testid": "count" }, agent.value.messages.length);
      },
    });

    const { wrapper } = mountWithProvider(() => h(Child), {
      agents__unsafe_dev_only: {
        "test-agent": agent as unknown as AbstractAgent,
      },
      defaultThrottleMs: Number.NaN,
    });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("CopilotKitProvider: defaultThrottleMs"),
    );

    agent.setMessages(buildMessages(1));
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("1");

    agent.setMessages(buildMessages(2));
    agent.notifyMessagesChanged();
    await flushVue();
    expect(wrapper.find("[data-testid=count]").text()).toBe("2");
  });
});
