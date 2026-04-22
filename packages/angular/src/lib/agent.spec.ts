import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AbstractAgent,
  type AgentSubscriber,
  type BaseEvent,
  type Message,
  type RunAgentInput,
  type State,
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
});
