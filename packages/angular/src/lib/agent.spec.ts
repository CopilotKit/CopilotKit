import {
  ChangeDetectionStrategy,
  Component,
  Input,
  signal,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AbstractAgent } from "@ag-ui/client";
import type {
  AgentSubscriber,
  BaseEvent,
  Message,
  RunAgentInput,
  State,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import { AgentStore, injectAgentStore } from "./agent";
import { CopilotKit } from "./copilotkit";
import {
  CopilotKitCore,
  ProxiedCopilotRuntimeAgent,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";

/** Shape of the `core` property on the stub — derived from CopilotKitCore
 *  via Pick so the fields stay in sync with the real class. */
type StubCore = Pick<
  CopilotKitCore,
  | "runtimeUrl"
  | "runtimeTransport"
  | "runtimeConnectionStatus"
  | "headers"
  | "subscribeToAgentWithOptions"
> & {
  agents?: Record<string, AbstractAgent>;
};

const DUMMY_RUN_INPUT: RunAgentInput = {
  threadId: "",
  runId: "",
  state: {},
  messages: [],
  tools: [],
  context: [],
  forwardedProps: {},
};

function userMsg(id: string, content: string): Message {
  return { id, role: "user" as const, content };
}

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

  emitMessages(messages: Message[]) {
    this.messages = messages;
    for (const s of this.subscribers) {
      s.onMessagesChanged?.({
        messages: this.messages,
        state: this.state,
        agent: this,
      });
    }
  }

  /** Mirrors AbstractAgent.addMessage: mutate the messages array in place and
   *  notify with the SAME array reference (no reassignment). */
  pushMessageInPlace(message: Message) {
    this.messages.push(message);
    for (const s of this.subscribers) {
      s.onMessagesChanged?.({
        messages: this.messages,
        state: this.state,
        agent: this,
      });
    }
  }

  emitState(state: State) {
    this.state = state;
    for (const s of this.subscribers) {
      s.onStateChanged?.({
        messages: this.messages,
        state: this.state,
        agent: this,
      });
    }
  }

  emitRunInitialized() {
    for (const s of this.subscribers) {
      s.onRunInitialized?.({
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
  #coreInstance = new CopilotKitCore({});
  core: StubCore = {
    runtimeUrl: undefined,
    runtimeTransport: "auto",
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Disconnected,
    headers: {},
    subscribeToAgentWithOptions:
      this.#coreInstance.subscribeToAgentWithOptions.bind(this.#coreInstance),
  };

  setAgents(map: Record<string, AbstractAgent>) {
    this.#agents.set(map);
    this.core = { ...this.core, agents: map };
  }

  setRuntimeConnectionStatus(value: CopilotKitCoreRuntimeConnectionStatus) {
    this.#runtimeConnectionStatus.set(value);
    this.core = { ...this.core, runtimeConnectionStatus: value };
  }

  setRuntimeUrl(value: string | undefined) {
    this.#runtimeUrl.set(value);
    this.core = { ...this.core, runtimeUrl: value };
  }

  setHeaders(value: Record<string, string>) {
    this.#headers.set(value);
    this.core = { ...this.core, headers: value };
  }

  setRuntimeTransport(value: "rest" | "single" | "auto") {
    this.#runtimeTransport.set(value);
    this.core = { ...this.core, runtimeTransport: value };
  }
}

describe("injectAgentStore", () => {
  let copilotKitStub: CopilotKitStub;

  beforeEach(() => {
    TestBed.resetTestingModule();
    copilotKitStub = new CopilotKitStub();

    TestBed.configureTestingModule({
      providers: [{ provide: CopilotKit, useValue: copilotKitStub }],
    });
  });

  it("creates AgentStore instances that mirror agent events", () => {
    const agent = new MockAgent("agent-1");
    copilotKitStub.setAgents({ "agent-1": agent });

    @Component({
      standalone: true,
      template: "",
    })
    class ConstantAgentHost {
      store = injectAgentStore("agent-1");
    }

    const fixture = TestBed.createComponent(ConstantAgentHost);
    fixture.detectChanges();

    const store = fixture.componentInstance.store();
    expect(store).toBeInstanceOf(AgentStore);
    expect(store?.agent).toBe(agent);

    agent.emitMessages([userMsg("1", "Hello")]);
    expect(store?.messages()).toEqual([userMsg("1", "Hello")]);

    agent.emitState({ loaded: true });
    expect(store?.state()).toEqual({ loaded: true });

    agent.emitRunInitialized();
    expect(store?.isRunning()).toBe(true);

    agent.emitRunFailed();
    expect(store?.isRunning()).toBe(false);
  });

  it("exposes messages and state restored before the store subscribes", () => {
    const agent = new MockAgent("agent-1");
    agent.messages = [userMsg("restored", "Welcome back")];
    agent.state = { document: "Restored draft" };
    copilotKitStub.setAgents({ "agent-1": agent });

    @Component({
      standalone: true,
      template: "",
    })
    class RestoredAgentHost {
      store = injectAgentStore("agent-1");
    }

    const fixture = TestBed.createComponent(RestoredAgentHost);
    fixture.detectChanges();

    const store = fixture.componentInstance.store();
    expect(store.messages()).toEqual([userMsg("restored", "Welcome back")]);
    expect(store.messages()).not.toBe(agent.messages);
    expect(store.state()).toEqual({ document: "Restored draft" });
  });

  it("disposes previous store when agent id changes and cleans up on destroy", () => {
    const firstAgent = new MockAgent("agent-1");
    const secondAgent = new MockAgent("agent-2");

    copilotKitStub.setAgents({
      "agent-1": firstAgent,
      "agent-2": secondAgent,
    });

    @Component({
      standalone: true,
      template: "",
    })
    class HostComponent {
      agentId = signal<string | undefined>("agent-1");
      store = injectAgentStore(this.agentId);
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.store()?.agent).toBe(firstAgent);

    fixture.componentInstance.agentId.set("agent-2");
    copilotKitStub.setAgents({
      "agent-1": firstAgent,
      "agent-2": secondAgent,
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.store()?.agent).toBe(secondAgent);
    expect(firstAgent.unsubscribeCount).toBe(1);

    fixture.destroy();
    expect(secondAgent.unsubscribeCount).toBe(1);
  });

  it("returns a proxied AgentStore while runtime is connecting", () => {
    copilotKitStub.setAgents({});
    copilotKitStub.setRuntimeUrl("https://runtime.local");
    copilotKitStub.setHeaders({ "x-test": "1" });
    copilotKitStub.setRuntimeConnectionStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connecting,
    );

    @Component({
      standalone: true,
      template: "",
    })
    class MissingAgentHost {
      store = injectAgentStore("missing");
    }

    const fixture = TestBed.createComponent(MissingAgentHost);
    fixture.detectChanges();

    const store = fixture.componentInstance.store();
    expect(store).toBeInstanceOf(AgentStore);

    const proxied = store.agent;
    expect(proxied).toBeInstanceOf(ProxiedCopilotRuntimeAgent);
    // Single narrowing after the instanceof assertion above
    const proxiedAgent = proxied as ProxiedCopilotRuntimeAgent;
    expect(proxiedAgent.agentId).toBe("missing");
    expect(proxiedAgent.headers).toEqual({ "x-test": "1" });
  });

  it("shares a provisional runtime agent across same-id consumers", () => {
    copilotKitStub.setAgents({});
    copilotKitStub.setRuntimeUrl("https://runtime.local");
    copilotKitStub.setRuntimeConnectionStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connecting,
    );

    @Component({
      standalone: true,
      template: "",
    })
    class ParallelConsumersHost {
      firstStore = injectAgentStore("shared-agent");
      secondStore = injectAgentStore("shared-agent");
    }

    const fixture = TestBed.createComponent(ParallelConsumersHost);
    fixture.detectChanges();

    expect(fixture.componentInstance.firstStore().agent).toBe(
      fixture.componentInstance.secondStore().agent,
    );
  });

  it("throws when agent cannot be resolved after runtime sync", () => {
    copilotKitStub.setAgents({});
    copilotKitStub.setRuntimeUrl("https://runtime.local");
    copilotKitStub.setRuntimeConnectionStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    @Component({
      standalone: true,
      template: "",
    })
    class MissingAgentHost {
      store = injectAgentStore("missing");
    }

    const fixture = TestBed.createComponent(MissingAgentHost);
    fixture.detectChanges();

    expect(() => fixture.componentInstance.store()).toThrowError(
      /injectAgentStore: Agent 'missing' not found after runtime sync/,
    );
  });

  // Regression: issue #5416. AbstractAgent.addMessage mutates its messages
  // array in place and notifies with the same reference; the store must not
  // forward that live reference, or the signal's Object.is check makes set()
  // a no-op and OnPush views never re-render until the run finishes.
  it("exposes a fresh array reference, not the agent's live messages array", () => {
    const agent = new MockAgent("agent-1");
    copilotKitStub.setAgents({ "agent-1": agent });

    @Component({
      standalone: true,
      template: "",
    })
    class Host {
      store = injectAgentStore("agent-1");
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const store = fixture.componentInstance.store();

    agent.pushMessageInPlace(userMsg("1", "Hello"));

    expect(store.messages()).toEqual([userMsg("1", "Hello")]);
    expect(store.messages()).not.toBe(agent.messages);
  });

  it("re-renders an OnPush view when messages are mutated in place", () => {
    const agent = new MockAgent("agent-1");
    copilotKitStub.setAgents({ "agent-1": agent });

    @Component({
      selector: "message-count",
      standalone: true,
      changeDetection: ChangeDetectionStrategy.OnPush,
      template: `
        {{ store.messages().length }}
      `,
    })
    class MessageCount {
      @Input({ required: true }) store!: AgentStore;
    }

    @Component({
      standalone: true,
      imports: [MessageCount],
      template: `
        <message-count [store]="store()" />
      `,
    })
    class Host {
      store = injectAgentStore("agent-1");
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const rendered = () => fixture.nativeElement.textContent.trim();
    expect(rendered()).toBe("0");

    // First in-place push: the signal's reference differs from its initial
    // value, so this notifies even with the bug present.
    agent.pushMessageInPlace(userMsg("1", "Hello"));
    fixture.detectChanges();
    expect(rendered()).toBe("1");

    // Second in-place push reuses the array reference the signal now holds.
    // Without the shallow copy this is an Object.is no-op: the signal never
    // notifies, the OnPush child stays clean, and the count stays at "1".
    agent.pushMessageInPlace(userMsg("2", "World"));
    fixture.detectChanges();
    expect(rendered()).toBe("2");
  });
});
