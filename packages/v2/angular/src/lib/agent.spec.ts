import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { AgentStore, injectAgentStore } from "./agent";
import { CopilotKit } from "./copilotkit";
import {
  ProxiedCopilotRuntimeAgent,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkitnext/core";

class MockAgent {
  readonly id: string;
  messages: any[] = [];
  state: any;
  #listeners = new Set<any>();
  unsubscribeCount = 0;

  constructor(id: string) {
    this.id = id;
  }

  subscribe(subscriber: any) {
    this.#listeners.add(subscriber);
    return {
      unsubscribe: () => {
        this.#listeners.delete(subscriber);
        this.unsubscribeCount += 1;
      },
    };
  }

  emitMessages(messages: any[]) {
    this.messages = messages;
    for (const listener of this.#listeners) {
      listener.onMessagesChanged?.();
    }
  }

  emitState(state: any) {
    this.state = state;
    for (const listener of this.#listeners) {
      listener.onStateChanged?.();
    }
  }

  emitRunInitialized(payload = {}) {
    for (const listener of this.#listeners) {
      listener.onRunInitialized?.(payload);
    }
  }

  emitRunFinalized(payload = {}) {
    for (const listener of this.#listeners) {
      listener.onRunFinalized?.(payload);
    }
  }

  emitRunFailed(payload = {}) {
    for (const listener of this.#listeners) {
      listener.onRunFailed?.(payload);
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
  readonly #runtimeTransport = signal<"rest" | "single">("rest");
  readonly #headers = signal<Record<string, string>>({});
  getAgent = vi.fn((id: string) => this.#agents()[id]);
  agents = this.#agents.asReadonly();
  runtimeConnectionStatus = this.#runtimeConnectionStatus.asReadonly();
  runtimeUrl = this.#runtimeUrl.asReadonly();
  runtimeTransport = this.#runtimeTransport.asReadonly();
  headers = this.#headers.asReadonly();
  core = {
    runtimeUrl: undefined as string | undefined,
    runtimeTransport: "rest" as const,
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Disconnected,
    headers: {} as Record<string, string>,
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

  setRuntimeTransport(value: "rest" | "single") {
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
    copilotKitStub.setAgents({ "agent-1": agent as unknown as AbstractAgent });

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

    agent.emitMessages([{ content: "Hello" }]);
    expect(store?.messages()).toEqual([{ content: "Hello" }]);

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
      "agent-1": firstAgent as unknown as AbstractAgent,
      "agent-2": secondAgent as unknown as AbstractAgent,
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
      "agent-1": firstAgent as unknown as AbstractAgent,
      "agent-2": secondAgent as unknown as AbstractAgent,
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
    expect(store.agent).toBeInstanceOf(ProxiedCopilotRuntimeAgent);
    expect((store.agent as ProxiedCopilotRuntimeAgent).agentId).toBe("missing");
    expect((store.agent as ProxiedCopilotRuntimeAgent).headers).toEqual({
      "x-test": "1",
    });
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
