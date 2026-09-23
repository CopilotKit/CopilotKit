import { describe, expect, it, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { CONNECTION_REPLAY_FINISHED } from "@copilotkit/shared";
import { from, lastValueFrom, Subject, toArray } from "rxjs";
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
const boundary = {
  type: EventType.CUSTOM,
  name: CONNECTION_REPLAY_FINISHED,
  value: null,
};

describe("memory runner replay lifecycle contract", () => {
  it("emits an opted-in boundary after historical errors, without persisting it or changing legacy output", async () => {
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
    const replay = await lastValueFrom(
      runner.connect({ threadId, replayLifecycle: true }).pipe(toArray()),
    );
    expect(legacy.at(-1)?.type).toBe(EventType.RUN_ERROR);
    expect(replay).toEqual([...legacy, boundary]);
    expect(runner.getThreadEvents(threadId)).not.toContainEqual(boundary);
  });

  it("places the boundary after buffered active-run events and before a live error", async () => {
    const runner = new InMemoryAgentRunner();
    const threadId = crypto.randomUUID();
    const input = inputFor(threadId, "active");
    const source = new Subject<BaseEvent>();
    const running = lastValueFrom(
      runner
        .run({ threadId, agent: new SourceAgent(source), input })
        .pipe(toArray()),
    );
    await vi.waitFor(() => expect(source.observed).toBe(true));
    const started = {
      type: EventType.RUN_STARTED,
      threadId,
      runId: input.runId,
    };
    source.next(started);
    const connected: BaseEvent[] = [];
    const subscription = runner
      .connect({ threadId, replayLifecycle: true })
      .subscribe((event) => connected.push(event));
    try {
      expect(connected.at(-1)).toEqual(boundary);
      const error = { type: EventType.RUN_ERROR, message: "Live failure" };
      source.next(error);
      source.complete();
      await running;
      expect(connected.at(-1)).toEqual(error);
      expect(
        connected.filter((event) => event.type === EventType.CUSTOM),
      ).toEqual([boundary]);
    } finally {
      source.complete();
      subscription.unsubscribe();
      await running;
    }
  });

  it("marks empty history complete only for clients that opt in", async () => {
    const runner = new InMemoryAgentRunner();
    const threadId = crypto.randomUUID();
    expect(
      await lastValueFrom(runner.connect({ threadId }).pipe(toArray())),
    ).toEqual([]);
    expect(
      await lastValueFrom(
        runner.connect({ threadId, replayLifecycle: true }).pipe(toArray()),
      ),
    ).toEqual([boundary]);
  });
});
