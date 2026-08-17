import {
  EnvironmentInjector,
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
  type Signal,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { AgentSubscriber, Interrupt } from "@ag-ui/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { injectAgentStore, type AgentStore } from "./agent";
import { COPILOT_CHAT_CONFIGURATION } from "./chat-configuration";
import { CopilotKit } from "./copilotkit";
import { injectInterrupt } from "./inject-interrupt";

vi.mock("./agent", () => ({ injectAgentStore: vi.fn() }));

const mockInjectAgentStore = vi.mocked(injectAgentStore);

class FakeAgent {
  readonly agentId = "support";
  threadId = "agent-thread";
  pendingInterrupts: Interrupt[] = [];
  subscriber?: AgentSubscriber;
  readonly unsubscribe = vi.fn();

  subscribe(subscriber: AgentSubscriber) {
    this.subscriber = subscriber;
    return { unsubscribe: this.unsubscribe };
  }

  addMessage = vi.fn();

  interrupt(id: string): void {
    const interrupts = [{ id, reason: "approval" }] as Interrupt[];
    this.subscriber?.onRunFinishedEvent?.({
      outcome: "interrupt",
      interrupts,
    } as never);
    this.subscriber?.onRunFinalized?.({} as never);
  }
}

describe("injectInterrupt", () => {
  const ambientAgentId = signal("ambient");
  const ambientThreadId = signal("ambient-thread");
  const runAgent = vi.fn(async () => ({ result: null, newMessages: [] }));
  let agent: FakeAgent;

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
    agent = new FakeAgent();
    mockInjectAgentStore.mockReturnValue(
      signal({ agent } as unknown as AgentStore),
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: CopilotKit, useValue: { core: { runAgent } } },
        {
          provide: COPILOT_CHAT_CONFIGURATION,
          useValue: {
            agentId: ambientAgentId,
            threadId: ambientThreadId,
          },
        },
      ],
    });
  });

  it("accepts an agent id directly and resolves against that agent's thread", async () => {
    const enabled = vi.fn(() => true);
    const injector = createEnvironmentInjector(
      [],
      TestBed.inject(EnvironmentInjector),
    );
    const controller = runInInjectionContext(injector, () =>
      injectInterrupt("support", { enabled }),
    );

    expect(mockInjectAgentStore).toHaveBeenCalledWith("support");
    TestBed.flushEffects();
    agent.interrupt("approve");
    await controller.resolve("yes");

    expect(enabled).toHaveBeenCalledTimes(1);
    expect(runAgent).toHaveBeenCalledWith({
      agent,
      resume: [{ interruptId: "approve", payload: "yes", status: "resolved" }],
    });

    injector.destroy();
    expect(agent.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("selects signal, ambient, and compatibility agent ids", () => {
    const agentId = signal<string | undefined>("support");

    TestBed.runInInjectionContext(() => injectInterrupt(agentId));
    expect(mockInjectAgentStore).toHaveBeenCalledWith(agentId);

    TestBed.runInInjectionContext(() => injectInterrupt());
    const ambient = mockInjectAgentStore.mock.calls.at(
      -1,
    )?.[0] as Signal<string>;
    expect(ambient()).toBe("ambient");

    TestBed.runInInjectionContext(() =>
      injectInterrupt({ agentId: "legacy", enabled: () => true }),
    );
    expect(mockInjectAgentStore).toHaveBeenLastCalledWith("legacy");
  });
});
