import { AbstractAgent } from "@ag-ui/client";
import { EventType, type ActivityMessage } from "@ag-ui/core";
import {
  Component,
  input,
  provideZonelessChangeDetection,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import {
  COPILOT_KIT_CONFIG,
  CopilotChat,
  CopilotKit,
  injectAgentStore,
  provideCopilotChatConfiguration,
  provideCopilotKit,
} from "@copilotkit/angular";
import {
  FakeRuntime,
  provideCopilotKitFake,
} from "@copilotkit/angular/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

@Component({
  template: `
    <p data-testid="progress">{{ content().title }}</p>
  `,
})
class ProgressRenderer {
  readonly content = input.required<{ title: string }>();
  readonly activityType = input.required<string>();
  readonly message = input.required<ActivityMessage>();
  readonly agent = input<AbstractAgent>();
}

const runStarted = (runId = "run-1") => ({
  type: EventType.RUN_STARTED,
  threadId: "test-thread",
  runId,
});
const runFinished = (runId = "run-1") => ({
  type: EventType.RUN_FINISHED,
  threadId: "test-thread",
  runId,
});

function setup() {
  TestBed.configureTestingModule({
    teardown: { destroyAfterEach: true },
    providers: [provideZonelessChangeDetection(), provideCopilotKitFake()],
  });
  const runtime = TestBed.inject(FakeRuntime);
  const copilotKit = TestBed.inject(CopilotKit);
  const store = TestBed.runInInjectionContext(() =>
    injectAgentStore("default"),
  );
  store().agent.threadId = "test-thread";
  return { runtime, copilotKit, store };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("provideCopilotKitFake", () => {
  it("replaces runtime configuration with an injector-scoped default agent", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({ runtimeUrl: "https://runtime.example.test" }),
        provideCopilotKitFake({ properties: { app: "test" } }),
      ],
    });

    const config = TestBed.inject(COPILOT_KIT_CONFIG);
    const copilotKit = TestBed.inject(CopilotKit);
    expect(config.runtimeUrl).toBeUndefined();
    expect(config.enableInspector).toBe(false);
    expect(config.properties).toEqual({ app: "test" });
    expect(copilotKit.getAgent("default")).toBeInstanceOf(AbstractAgent);
    expect(TestBed.inject(FakeRuntime)).toBe(TestBed.inject(FakeRuntime));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("registers each requested agent and emits only to that agent", async () => {
    TestBed.configureTestingModule({
      teardown: { destroyAfterEach: true },
      providers: [
        provideZonelessChangeDetection(),
        provideCopilotKitFake({ agentIds: ["agent-one", "agent-two"] }),
      ],
    });
    const copilotKit = TestBed.inject(CopilotKit);
    const one = copilotKit.getAgent("agent-one");
    const two = copilotKit.getAgent("agent-two");
    expect(one?.agentId).toBe("agent-one");
    expect(two?.agentId).toBe("agent-two");
    expect(copilotKit.getAgent("default")).toBeUndefined();

    const runtime = TestBed.inject(FakeRuntime);
    const runOne = one!.runAgent();
    const runTwo = two!.runAgent();
    runtime.emitActivityMessage(
      { message: "for two" },
      "message",
      crypto.randomUUID(),
      "agent-two",
    );

    await expect
      .poll(() =>
        two!.messages.filter((message) => message.role === "activity"),
      )
      .toHaveLength(1);
    expect(
      one!.messages.filter((message) => message.role === "activity"),
    ).toEqual([]);

    runtime.complete();
    await Promise.all([runOne, runTwo]);
  });

  it("processes message and state events through the real agent store", async () => {
    const { runtime, copilotKit, store } = setup();
    const run = copilotKit.core.runAgent({ agent: store().agent });

    // No timer or subscription spy: initialization may still be awaiting hooks.
    runtime.emit(runStarted());
    runtime.emit({
      type: EventType.TEXT_MESSAGE_START,
      messageId: "answer",
      role: "assistant",
    });
    runtime.emit({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "answer",
      delta: "Hello",
    });
    runtime.emit({ type: EventType.TEXT_MESSAGE_END, messageId: "answer" });
    runtime.emit({ type: EventType.STATE_SNAPSHOT, snapshot: { count: 1 } });

    await expect.poll(() => store().state()).toEqual({ count: 1 });
    expect(store().messages()).toEqual([
      expect.objectContaining({
        id: "answer",
        role: "assistant",
        content: "Hello",
      }),
    ]);
    expect(store().isRunning()).toBe(true);

    runtime.emit(runFinished());
    runtime.complete();
    await run;
    expect(store().isRunning()).toBe(false);
  });

  it("starts a run for an activity snapshot and leaves that run open", async () => {
    const { runtime, copilotKit, store } = setup();
    const run = copilotKit.core.runAgent({ agent: store().agent });

    runtime.emitActivityMessage("Hello");

    await expect.poll(() => store().isRunning()).toBe(true);
    runtime.emit(runFinished());
    runtime.complete();
    await run;
    expect(store().isRunning()).toBe(false);
  });

  it("renders successive activity snapshots through CopilotChat", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: () => undefined,
    });
    TestBed.configureTestingModule({
      imports: [CopilotChat],
      providers: [
        provideZonelessChangeDetection(),
        provideCopilotKitFake({
          renderActivityMessages: [
            {
              activityType: "progress",
              content: z.object({ title: z.string() }),
              component: ProgressRenderer,
            },
          ],
        }),
        provideCopilotChatConfiguration(),
      ],
    });
    const fixture = TestBed.createComponent(CopilotChat);
    const runtime = TestBed.inject(FakeRuntime);
    await fixture.whenStable();
    const run = fixture.componentInstance.submitInput("Start search");
    runtime.emit(runStarted());
    const snapshot = (title: string) => ({
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "progress-1",
      activityType: "progress",
      content: { title },
    });
    const progress = () =>
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="progress"]',
      )?.textContent;

    runtime.emit(snapshot("Searching"));
    await expect.poll(progress).toBe("Searching");
    runtime.emit(snapshot("Done"));
    await expect.poll(progress).toBe("Done");
    expect(
      fixture.nativeElement.querySelectorAll('[data-testid="progress"]'),
    ).toHaveLength(1);

    runtime.emit(runFinished());
    runtime.complete();
    await run;
    await fixture.whenStable();
  });

  it("uses a fresh event stream for each subsequent run", async () => {
    const { runtime, copilotKit, store } = setup();
    const received: unknown[] = [];
    store().agent.subscribe({
      onStateSnapshotEvent: ({ event }) => {
        received.push(event.snapshot);
      },
    });

    for (const count of [1, 2]) {
      const run = copilotKit.core.runAgent({ agent: store().agent });
      runtime.emit(runStarted(`run-${count}`));
      runtime.emit({ type: EventType.STATE_SNAPSHOT, snapshot: { count } });
      runtime.emit(runFinished(`run-${count}`));
      runtime.complete();
      await run;
      expect(store().state()).toEqual({ count });
    }
    expect(received).toEqual([{ count: 1 }, { count: 2 }]);
  });

  it("closes pending streams on teardown and isolates the next TestBed", async () => {
    const first = setup();
    const run = first.copilotKit.core.runAgent({ agent: first.store().agent });
    first.runtime.emit(runStarted());
    first.runtime.emit({
      type: EventType.STATE_SNAPSHOT,
      snapshot: { old: true },
    });
    await expect.poll(() => first.store().state()).toEqual({ old: true });
    first.runtime.emit(runFinished());
    TestBed.resetTestingModule();
    await run;

    const second = setup();
    expect(second.runtime).not.toBe(first.runtime);
    expect(second.store().state()).toEqual({});
    expect(second.store().messages()).toEqual([]);
  });
});
