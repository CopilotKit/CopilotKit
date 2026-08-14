import type {
  AbstractAgent as AbstractAgentType,
  AgentSubscriber,
} from "@ag-ui/client";
import { EMPTY as emptyObservable } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProxiedCopilotRuntimeAgent } from "../agent";

vi.mock("../intelligence-agent", async () => {
  const { AbstractAgent, EventType } = await import("@ag-ui/client");
  const { EMPTY } = await import("rxjs");

  class ForwardingTestIntelligenceAgent extends AbstractAgent {
    run() {
      return EMPTY;
    }

    override async connectAgent(
      _parameters?: Parameters<AbstractAgentType["connectAgent"]>[0],
      subscriber?: AgentSubscriber,
    ) {
      const input = {
        threadId: this.threadId,
        runId: "delegate-run",
        messages: this.messages,
        state: this.state,
        tools: [],
        context: [],
        forwardedProps: {},
      };
      for (const current of [...this.subscribers, subscriber ?? {}]) {
        await current.onEvent?.({
          event: {
            type: EventType.CUSTOM,
            name: "forwarding-test",
            value: null,
          },
          input,
          messages: this.messages,
          state: this.state,
          agent: this,
        });
      }
      return { result: undefined, newMessages: [] };
    }
  }

  return { IntelligenceAgent: ForwardingTestIntelligenceAgent };
});

function createAgent(compactRestore = true): ProxiedCopilotRuntimeAgent {
  return new ProxiedCopilotRuntimeAgent({
    runtimeUrl: "https://runtime.example",
    agentId: "default",
    compactRestore,
  });
}

function createIntelligenceAgent(): ProxiedCopilotRuntimeAgent {
  return new ProxiedCopilotRuntimeAgent({
    runtimeUrl: "https://runtime.example",
    agentId: "default",
    runtimeMode: "intelligence",
    intelligence: { wsUrl: "wss://runtime.example/client" },
  });
}

describe("ProxiedCopilotRuntimeAgent compact restore mutation warning", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    "onEvent",
    "onToolCallStartEvent",
    "onRunInitialized",
    "onRunFailed",
    "onRunFinalized",
  ] as const)("warns for the mutation-capable %s callback", (callbackName) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = createAgent();

    agent.subscribe({
      [callbackName]: () => ({ state: { replaced: true } }),
    } as AgentSubscriber);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/compact restore/i);
    expect(warn.mock.calls[0]?.[0]).toMatch(/immutable/i);
    expect(warn.mock.calls[0]?.[0]).toMatch(
      /returned messages.*state mutations/i,
    );
    expect(warn.mock.calls[0]?.[0]).toContain("compactRestore: false");
  });

  it("recognizes mutation-capable callbacks declared as class methods", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    class ClassSubscriber implements AgentSubscriber {
      onEvent() {
        return { state: { replaced: true } };
      }
    }

    createAgent().subscribe(new ClassSubscriber());

    expect(warn).toHaveBeenCalledOnce();
  });

  it("warns only once per public agent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = createAgent();

    agent.subscribe({ onEvent: () => ({ state: {} }) });
    agent.subscribe({ onStateDeltaEvent: () => ({ state: {} }) });

    expect(warn).toHaveBeenCalledOnce();
  });

  it("does not warn for notification-only callbacks", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = createAgent();

    agent.subscribe({
      onMessagesChanged: () => {},
      onStateChanged: () => {},
      onNewMessage: () => {},
      onNewToolCall: () => {},
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    createAgent().subscribe({ onEvent: () => ({ state: {} }) });

    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn when compact restore is disabled", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    createAgent(false).subscribe({ onEvent: () => ({ state: {} }) });

    expect(warn).not.toHaveBeenCalled();
  });

  it("does not throw in a browser-like environment without global process", () => {
    const processDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "process",
    );
    Reflect.deleteProperty(globalThis, "process");

    try {
      expect(() =>
        createAgent().subscribe({ onEvent: () => ({ state: {} }) }),
      ).not.toThrow();
    } finally {
      if (processDescriptor) {
        Object.defineProperty(globalThis, "process", processDescriptor);
      }
    }
  });

  it("preserves the base subscription and unsubscription behavior", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = createAgent();
    const subscriber: AgentSubscriber = {
      onEvent: () => ({ state: {} }),
    };

    const subscription = agent.subscribe(subscriber);
    expect(agent.subscribers).toContain(subscriber);

    subscription.unsubscribe();
    expect(agent.subscribers).not.toContain(subscriber);
  });

  it("warns independently for a cloned public agent without forwarding a duplicate", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = createAgent();
    const clone = agent.clone();

    agent.subscribe({ onEvent: () => ({ state: {} }) });
    clone.subscribe({ onEvent: () => ({ state: {} }) });
    clone.subscribe({ onRawEvent: () => ({ state: {} }) });

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("does not warn again when public and direct subscribers reach an Intelligence delegate", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registeredOnEvent = vi.fn(() => ({ state: { registered: true } }));
    const directOnEvent = vi.fn(() => ({ state: { direct: true } }));
    const agent = createIntelligenceAgent();
    agent.threadId = "thread-1";
    agent.subscribe({ onEvent: registeredOnEvent });

    await agent.connectAgent(
      { runId: "connect-1" },
      { onEvent: directOnEvent },
    );

    expect(registeredOnEvent).toHaveBeenCalledOnce();
    expect(directOnEvent).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  });

  it.each(["sse", "intelligence"] as const)(
    "warns for a direct mutation-capable runAgent subscriber in %s mode",
    async (runtimeMode) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const onRunInitialized = vi.fn(() => ({ state: { direct: true } }));
      const agent =
        runtimeMode === "intelligence"
          ? createIntelligenceAgent()
          : createAgent();
      agent.threadId = "thread-1";
      if (runtimeMode === "sse") {
        agent.run = () => emptyObservable;
      }

      await agent.runAgent({ runId: "run-1" }, { onRunInitialized });

      expect(onRunInitialized).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledOnce();
    },
  );

  it("warns for a direct mutation-capable non-Intelligence connectAgent subscriber", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onRunInitialized = vi.fn(() => ({ state: { direct: true } }));
    const agent = createAgent();
    agent.threadId = "thread-1";
    agent.connect = () => emptyObservable;

    await agent.connectAgent({ runId: "connect-1" }, { onRunInitialized });

    expect(onRunInitialized).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  });
});
