import { ChangeDetectorRef } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AbstractAgent } from "@ag-ui/client";
import type {
  AgentSubscriber,
  BaseEvent,
  RunAgentInput,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import { CopilotChat } from "../copilot-chat";
import { CopilotKit } from "../../../copilotkit";
import { CopilotKitCore } from "@copilotkit/core";

const DUMMY_RUN_INPUT: RunAgentInput = {
  threadId: "",
  runId: "",
  state: {},
  messages: [],
  tools: [],
  context: [],
  forwardedProps: {},
};

class Deferred {
  promise: Promise<void>;
  resolve!: () => void;

  constructor() {
    this.promise = new Promise<void>((resolve) => {
      this.resolve = resolve;
    });
  }
}

class MockAgent extends AbstractAgent {
  constructor() {
    super();
    this.agentId = "default";
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable();
  }

  setActiveRunCompletionPromise(promise: Promise<void>): void {
    Object.defineProperty(this, "activeRunCompletionPromise", {
      configurable: true,
      value: promise,
    });
  }

  emitRunInitialized(): void {
    this.emit((subscriber) =>
      subscriber.onRunInitialized?.({
        messages: this.messages,
        state: this.state,
        agent: this,
        input: DUMMY_RUN_INPUT,
      }),
    );
  }

  emitRunFinalized(): void {
    this.emit((subscriber) =>
      subscriber.onRunFinalized?.({
        messages: this.messages,
        state: this.state,
        agent: this,
        input: DUMMY_RUN_INPUT,
      }),
    );
  }

  private emit(callback: (subscriber: AgentSubscriber) => void): void {
    for (const subscriber of this.subscribers) callback(subscriber);
  }
}

class CopilotKitStub {
  agent = new MockAgent();
  coreInstance = new CopilotKitCore({});
  agents = vi.fn(() => ({ default: this.agent }));
  runtimeConnectionStatus = vi.fn(() => undefined);
  runtimeUrl = vi.fn(() => undefined);
  runtimeTransport = vi.fn(() => "auto");
  headers = vi.fn(() => ({}));
  getAgent = vi.fn(() => this.agent);
  core = {
    subscribeToAgentWithOptions:
      this.coreInstance.subscribeToAgentWithOptions.bind(this.coreInstance),
    connectAgent: vi.fn(),
    runAgent: vi.fn().mockResolvedValue(undefined),
    stopAgent: vi.fn(),
    runtimeConnectionStatus: undefined,
    runtimeUrl: undefined,
    runtimeTransport: "auto",
    headers: {},
  };
}

describe("CopilotChat", () => {
  let copilotKit: CopilotKitStub;

  beforeEach(() => {
    TestBed.resetTestingModule();
    copilotKit = new CopilotKitStub();
    TestBed.configureTestingModule({
      imports: [CopilotChat],
      providers: [
        { provide: CopilotKit, useValue: copilotKit },
        { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn() } },
      ],
    });
  });

  it("waits for the active run to finish before adding the next message", async () => {
    const fixture = TestBed.createComponent(CopilotChat);
    fixture.detectChanges();
    const deferred = new Deferred();

    copilotKit.agent.setActiveRunCompletionPromise(deferred.promise);
    copilotKit.agent.emitRunInitialized();

    const submitPromise = fixture.componentInstance.submitInput("next turn");

    await Promise.resolve();

    expect(copilotKit.agent.messages).toHaveLength(0);
    expect(copilotKit.core.runAgent).not.toHaveBeenCalled();

    deferred.resolve();
    await submitPromise;

    expect(copilotKit.agent.messages).toMatchObject([
      { role: "user", content: "next turn" },
    ]);
    expect(copilotKit.core.runAgent).toHaveBeenCalledWith({
      agent: copilotKit.agent,
    });
  });

  it("stops through core.stopAgent and falls back to abortRun when needed", () => {
    const fixture = TestBed.createComponent(CopilotChat);
    fixture.detectChanges();
    const abortRun = vi.spyOn(copilotKit.agent, "abortRun");

    fixture.componentInstance.stopCurrentRun();
    expect(copilotKit.core.stopAgent).toHaveBeenCalledWith({
      agent: copilotKit.agent,
    });
    expect(abortRun).not.toHaveBeenCalled();

    copilotKit.core.stopAgent.mockImplementationOnce(() => {
      throw new Error("stop failed");
    });

    fixture.componentInstance.stopCurrentRun();
    expect(abortRun).toHaveBeenCalledTimes(1);
  });
});
