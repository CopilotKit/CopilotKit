import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AbstractAgent,
  type AgentSubscriber,
  type BaseEvent,
  type RunAgentInput,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import { CopilotKit } from "./copilotkit";
import {
  injectInterrupt,
  type InterruptEvent,
  type InterruptStoreSignal,
} from "./interrupt";

const DUMMY_RUN_INPUT: RunAgentInput = {
  threadId: "",
  runId: "",
  state: {},
  messages: [],
  tools: [],
  context: [],
  forwardedProps: {},
};

class MockAgent extends AbstractAgent {
  unsubscribeCount = 0;

  constructor(id: string) {
    super();
    this.agentId = id;
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable();
  }

  override subscribe(subscriber: AgentSubscriber) {
    const sub = super.subscribe(subscriber);
    return {
      unsubscribe: () => {
        sub.unsubscribe();
        this.unsubscribeCount += 1;
      },
    };
  }

  emitCustomEvent(name: string, value: unknown) {
    for (const s of this.subscribers) {
      s.onCustomEvent?.({
        // @ts-expect-error CustomEvent shape varies between versions
        event: { name, value },
        messages: this.messages,
        state: this.state,
        agent: this,
      });
    }
  }

  emitRunStartedEvent() {
    for (const s of this.subscribers) {
      s.onRunStartedEvent?.({
        // @ts-expect-error event shape minimal
        event: {},
        messages: this.messages,
        state: this.state,
        agent: this,
        input: DUMMY_RUN_INPUT,
      });
    }
  }

  emitRunFinalized() {
    for (const s of this.subscribers) {
      s.onRunFinalized?.({
        messages: this.messages,
        state: this.state,
        agent: this,
        input: DUMMY_RUN_INPUT,
      });
    }
  }

  emitRunFailed() {
    for (const s of this.subscribers) {
      s.onRunFailed?.({
        messages: this.messages,
        state: this.state,
        agent: this,
        input: DUMMY_RUN_INPUT,
        error: new Error("run failed"),
      });
    }
  }
}

class CopilotKitStub {
  readonly #agents = signal<Record<string, AbstractAgent>>({});
  readonly #runtimeConnectionStatus =
    signal<CopilotKitCoreRuntimeConnectionStatus>(
      CopilotKitCoreRuntimeConnectionStatus.Disconnected,
    );
  readonly #runtimeUrl = signal<string | undefined>(undefined);
  readonly #runtimeTransport = signal<"rest" | "single" | "auto">("auto");
  readonly #headers = signal<Record<string, string>>({});

  getAgent = vi.fn((id: string) => this.#agents()[id]);
  agents = this.#agents.asReadonly();
  runtimeConnectionStatus = this.#runtimeConnectionStatus.asReadonly();
  runtimeUrl = this.#runtimeUrl.asReadonly();
  runtimeTransport = this.#runtimeTransport.asReadonly();
  headers = this.#headers.asReadonly();

  // Real CopilotKitCore so subscribeToAgentWithOptions works for AgentStore.
  #coreInstance = new CopilotKitCore({});
  runAgentMock = vi.fn(async () => {});
  core = {
    runtimeUrl: undefined as string | undefined,
    runtimeTransport: "auto" as "rest" | "single" | "auto",
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Disconnected,
    headers: {} as Record<string, string>,
    subscribeToAgentWithOptions:
      this.#coreInstance.subscribeToAgentWithOptions.bind(this.#coreInstance),
    runAgent: this.runAgentMock,
  };

  setAgents(map: Record<string, AbstractAgent>) {
    this.#agents.set(map);
    this.core = { ...this.core, ...({ agents: map } as object) };
  }
}

interface HarnessOpts<TValue = unknown, TResult = unknown> {
  agentId?: string;
  enabled?: (event: InterruptEvent<TValue>) => boolean;
  handler?: (props: {
    event: InterruptEvent<TValue>;
    resolve: (response: unknown) => void;
  }) => TResult | PromiseLike<TResult>;
}

function createHost<TValue = unknown, TResult = unknown>(
  opts: HarnessOpts<TValue, TResult> = {},
) {
  @Component({ standalone: true, template: "" })
  class Host {
    interrupt = injectInterrupt<TValue, TResult>({
      agentId: opts.agentId,
      enabled: opts.enabled,
      handler: opts.handler,
    });
  }
  return Host;
}

function flushMicrotasks() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("injectInterrupt", () => {
  let copilotKitStub: CopilotKitStub;
  let agent: MockAgent;

  beforeEach(() => {
    TestBed.resetTestingModule();
    copilotKitStub = new CopilotKitStub();
    agent = new MockAgent("agent-1");
    copilotKitStub.setAgents({ "agent-1": agent });

    TestBed.configureTestingModule({
      providers: [{ provide: CopilotKit, useValue: copilotKitStub }],
    });
  });

  function setUp<TValue = unknown, TResult = unknown>(
    opts: HarnessOpts<TValue, TResult> = {},
  ) {
    const Host = createHost<TValue, TResult>({
      agentId: "agent-1",
      ...opts,
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const interrupt = fixture.componentInstance
      .interrupt as InterruptStoreSignal<TValue, TResult>;
    return { fixture, interrupt };
  }

  it("subscribes to the agent and tears down on destroy", () => {
    const { fixture } = setUp();
    // injectInterrupt + the underlying AgentStore each add a subscriber.
    const initial = agent.subscribers.length;
    expect(initial).toBeGreaterThanOrEqual(1);
    fixture.destroy();
    // Both subscriptions should be released — the interrupt subscription
    // contributes at least one to unsubscribeCount.
    expect(agent.unsubscribeCount).toBeGreaterThanOrEqual(1);
    expect(agent.subscribers.length).toBeLessThan(initial);
  });

  it("ignores non-interrupt custom events", () => {
    const { interrupt } = setUp();
    agent.emitCustomEvent("not_interrupt", "x");
    agent.emitRunFinalized();
    expect(interrupt.event()).toBeNull();
    expect(interrupt.isPending()).toBe(false);
  });

  it("renders interrupt only after run finalized", () => {
    const { interrupt } = setUp();
    agent.emitCustomEvent("on_interrupt", "pending");
    expect(interrupt.event()).toBeNull();
    agent.emitRunFinalized();
    expect(interrupt.event()).toEqual({
      name: "on_interrupt",
      value: "pending",
    });
    expect(interrupt.isPending()).toBe(true);
  });

  it("clears pending interrupt on run start", () => {
    const { interrupt } = setUp();
    agent.emitCustomEvent("on_interrupt", "first");
    agent.emitRunFinalized();
    expect(interrupt.event()).not.toBeNull();
    agent.emitRunStartedEvent();
    expect(interrupt.event()).toBeNull();
  });

  it("resolve clears state and resumes agent with response payload", () => {
    const { interrupt } = setUp();
    agent.emitCustomEvent("on_interrupt", "approve-me");
    agent.emitRunFinalized();
    expect(interrupt.event()).not.toBeNull();

    interrupt.resolve({ approved: true, value: "approve-me" });

    expect(interrupt.event()).toBeNull();
    expect(copilotKitStub.runAgentMock).toHaveBeenCalledTimes(1);
    expect(copilotKitStub.runAgentMock).toHaveBeenCalledWith({
      agent,
      forwardedProps: {
        command: {
          resume: { approved: true, value: "approve-me" },
          interruptEvent: "approve-me",
        },
      },
    });
  });

  it("resolve is a no-op when no interrupt is pending", () => {
    const { interrupt } = setUp();
    interrupt.resolve("noop");
    expect(copilotKitStub.runAgentMock).not.toHaveBeenCalled();
  });

  it("does not expose interrupt and does not run handler when enabled returns false", () => {
    const handler = vi.fn(() => "should-not-run");
    const { interrupt } = setUp({
      enabled: () => false,
      handler,
    });

    agent.emitCustomEvent("on_interrupt", "blocked");
    agent.emitRunFinalized();

    expect(interrupt.event()).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });

  it("exposes interrupt with null result when no handler is provided", () => {
    const { interrupt } = setUp();
    agent.emitCustomEvent("on_interrupt", "no-handler");
    agent.emitRunFinalized();
    expect(interrupt.event()).toEqual({
      name: "on_interrupt",
      value: "no-handler",
    });
    expect(interrupt.result()).toBeNull();
  });

  it("uses sync handler result", () => {
    const { interrupt } = setUp({
      handler: ({ event }) => `handled:${String(event.value)}`,
    });
    agent.emitCustomEvent("on_interrupt", "sync");
    agent.emitRunFinalized();
    expect(interrupt.result()).toBe("handled:sync");
  });

  it("uses async handler resolved value", async () => {
    const { interrupt } = setUp({
      handler: ({ event }) => Promise.resolve(`async:${String(event.value)}`),
    });
    agent.emitCustomEvent("on_interrupt", "value");
    agent.emitRunFinalized();

    // While pending, result should be null.
    expect(interrupt.result()).toBeNull();

    await flushMicrotasks();
    expect(interrupt.result()).toBe("async:value");
  });

  it("falls back to null result when async handler rejects", async () => {
    const { interrupt } = setUp({
      handler: () => Promise.reject(new Error("boom")),
    });
    agent.emitCustomEvent("on_interrupt", "reject");
    agent.emitRunFinalized();

    await flushMicrotasks();
    expect(interrupt.result()).toBeNull();
    // Event is still pending; only result is null.
    expect(interrupt.event()?.value).toBe("reject");
  });

  it("accepts thenable handler results (non-native Promise)", async () => {
    const thenable = {
      then(resolve: (value: string) => void) {
        resolve("thenable-ok");
        return { catch: () => undefined };
      },
    };
    const { interrupt } = setUp({
      handler: () => thenable as unknown as PromiseLike<string>,
    });
    agent.emitCustomEvent("on_interrupt", "thenable");
    agent.emitRunFinalized();

    await flushMicrotasks();
    expect(interrupt.result()).toBe("thenable-ok");
  });

  it("discards local interrupt when run fails before finalize", () => {
    const { interrupt } = setUp();
    agent.emitCustomEvent("on_interrupt", "lost");
    agent.emitRunFailed();
    agent.emitRunFinalized();
    expect(interrupt.event()).toBeNull();
  });

  it("keeps the latest interrupt when multiple arrive within one run", () => {
    const { interrupt } = setUp();
    agent.emitCustomEvent("on_interrupt", "first");
    agent.emitCustomEvent("on_interrupt", "second");
    agent.emitRunFinalized();
    expect(interrupt.event()?.value).toBe("second");
  });

  it("ignores stale handler resolutions when a new interrupt arrives", async () => {
    let resolveFirst: ((value: string) => void) | null = null;
    const { interrupt } = setUp({
      handler: ({ event }) => {
        if (event.value === "first") {
          return new Promise<string>((r) => {
            resolveFirst = r;
          });
        }
        return Promise.resolve(`handled:${String(event.value)}`);
      },
    });

    agent.emitCustomEvent("on_interrupt", "first");
    agent.emitRunFinalized();
    // First handler is in-flight; result should be null.
    expect(interrupt.result()).toBeNull();

    // A new run starts and finalizes with a different interrupt.
    agent.emitRunStartedEvent();
    agent.emitCustomEvent("on_interrupt", "second");
    agent.emitRunFinalized();

    // Resolve the first handler late — should be ignored.
    resolveFirst?.("late-first");
    await flushMicrotasks();

    expect(interrupt.event()?.value).toBe("second");
    expect(interrupt.result()).toBe("handled:second");
  });

  it("discards async handler result when resolve was called before it settled", async () => {
    let settleHandler: ((value: string) => void) | null = null;
    const { interrupt } = setUp<string, string>({
      handler: () =>
        new Promise<string>((r) => {
          settleHandler = r;
        }),
    });

    agent.emitCustomEvent("on_interrupt", "pending");
    agent.emitRunFinalized();
    expect(interrupt.event()?.value).toBe("pending");
    expect(interrupt.result()).toBeNull();

    // User resolves before the handler promise settles.
    interrupt.resolve("user-response");
    expect(interrupt.event()).toBeNull();
    expect(interrupt.result()).toBeNull();

    // Now the handler's promise settles — its result should be discarded.
    settleHandler?.("late-handler-result");
    await flushMicrotasks();

    expect(interrupt.result()).toBeNull();
    expect(interrupt.event()).toBeNull();
  });

  it("resolve passes the interrupt's value (not the response) as interruptEvent", () => {
    const payload = { question: "approve?", id: 42 };
    const { interrupt } = setUp<typeof payload>();
    agent.emitCustomEvent("on_interrupt", payload);
    agent.emitRunFinalized();

    interrupt.resolve("user-says-yes");

    expect(copilotKitStub.runAgentMock).toHaveBeenCalledWith({
      agent,
      forwardedProps: {
        command: {
          resume: "user-says-yes",
          interruptEvent: payload,
        },
      },
    });
  });
});
