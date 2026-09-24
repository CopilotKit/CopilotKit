import { describe, expect, it, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { from, lastValueFrom, Subject, tap, toArray } from "rxjs";
import type { Observable } from "rxjs";
import { InMemoryAgentRunner } from "../in-memory";

class SourceAgent extends AbstractAgent {
  constructor(private readonly events: Observable<BaseEvent>) {
    super({ agentId: "replay-contract" });
  }
  run() {
    return this.events;
  }
}
const inputFor = (threadId: string, runId: string): RunAgentInput => ({
  threadId,
  runId,
  state: {},
  messages: [],
  tools: [],
  context: [],
  forwardedProps: {},
});

describe("memory runner replay lifecycle contract", () => {
  it("calls hooks around history without adding or persisting AG-UI events", async () => {
    const runner = new InMemoryAgentRunner();
    const threadId = crypto.randomUUID();
    const input = inputFor(threadId, "failed");
    const agent = new SourceAgent(
      from<BaseEvent[]>([
        { type: EventType.RUN_STARTED, threadId, runId: input.runId },
        { type: EventType.RUN_ERROR, message: "Historical failure" },
      ]),
    );
    await lastValueFrom(runner.run({ threadId, agent, input }).pipe(toArray()));
    const legacy = await lastValueFrom(
      runner.connect({ threadId }).pipe(toArray()),
    );
    const order: unknown[] = [];
    const replay$ = runner.connect({
      threadId,
      onReplayStarted: () => order.push("started"),
      onReplayFinished: () => order.push("finished"),
    });
    expect(order).toEqual([]);
    const replay: BaseEvent[] = [];
    replay$.subscribe((event) => {
      replay.push(event);
      order.push(event);
    });
    expect(legacy.at(-1)?.type).toBe(EventType.RUN_ERROR);
    expect(replay).toEqual(legacy);
    expect(order).toEqual(["started", ...legacy, "finished"]);
    expect(
      runner
        .getThreadEvents(threadId)
        .some((event) => event.type === EventType.CUSTOM),
    ).toBe(false);
  });

  it("places the boundary after buffered active-run events and before a live error", async () => {
    const runner = new InMemoryAgentRunner();
    const threadId = crypto.randomUUID();
    const input = inputFor(threadId, "active");
    const source = new Subject<BaseEvent>();
    const delivered: BaseEvent[] = [];
    const running = lastValueFrom(
      runner.run({ threadId, agent: new SourceAgent(source), input }).pipe(
        tap((event) => delivered.push(event)),
        toArray(),
      ),
    );
    await vi.waitFor(() => expect(source.observed).toBe(true));
    const started = {
      type: EventType.RUN_STARTED,
      threadId,
      runId: input.runId,
    };
    source.next(started);
    await vi.waitFor(() => expect(delivered).toHaveLength(1));
    const connected: (BaseEvent | string)[] = [];
    const subscription = runner
      .connect({
        threadId,
        onReplayStarted: () => connected.push("started"),
        onReplayFinished: () => connected.push("finished"),
      })
      .subscribe((event) => connected.push(event));
    try {
      expect(connected).toEqual(["started", ...delivered, "finished"]);
      const error = { type: EventType.RUN_ERROR, message: "Live failure" };
      source.next(error);
      source.complete();
      await running;
      expect(connected.at(-1)).toEqual(error);
      expect(connected.filter((event) => event === "finished")).toEqual([
        "finished",
      ]);
    } finally {
      source.complete();
      subscription.unsubscribe();
      await running;
    }
  });

  it("calls both hooks for empty history without emitting events", async () => {
    const runner = new InMemoryAgentRunner();
    const order: string[] = [];
    const events = await lastValueFrom(
      runner
        .connect({
          threadId: crypto.randomUUID(),
          onReplayStarted: () => order.push("started"),
          onReplayFinished: () => order.push("finished"),
        })
        .pipe(toArray()),
    );
    expect(events).toEqual([]);
    expect(order).toEqual(["started", "finished"]);
  });
});
