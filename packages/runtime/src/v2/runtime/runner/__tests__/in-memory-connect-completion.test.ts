import { expect, it, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Subject, lastValueFrom, tap, toArray } from "rxjs";
import { InMemoryAgentRunner } from "../in-memory";

it("keeps a memory connection open after RUN_ERROR until the agent source closes", async () => {
  const source = new Subject<BaseEvent>();
  class TestAgent extends AbstractAgent {
    run() {
      return source;
    }
  }
  const runner = new InMemoryAgentRunner();
  const threadId = crypto.randomUUID();
  const input: RunAgentInput = {
    threadId,
    runId: "live",
    messages: [],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  };
  const delivered: BaseEvent[] = [];
  const running = lastValueFrom(
    runner.run({ threadId, agent: new TestAgent(), input }).pipe(
      tap((event) => delivered.push(event)),
      toArray(),
    ),
  );
  try {
    await vi.waitFor(() => expect(source.observed).toBe(true));
    source.next({ type: EventType.RUN_STARTED, threadId, runId: input.runId });
    await vi.waitFor(() => expect(delivered).toHaveLength(1));
    const completed = vi.fn();
    const connection = runner
      .connect({ threadId })
      .pipe(tap({ complete: completed }), toArray());
    const replayed = lastValueFrom(connection);
    source.next({ type: EventType.RUN_ERROR, message: "Live failure" });
    await vi.waitFor(() =>
      expect(delivered.at(-1)).toMatchObject({ type: EventType.RUN_ERROR }),
    );
    expect(completed).not.toHaveBeenCalled();
    expect(await runner.isRunning({ threadId })).toBe(true);
    source.complete();
    await vi.waitFor(() => expect(completed).toHaveBeenCalledOnce());
    expect((await replayed).at(-1)).toMatchObject({
      type: EventType.RUN_ERROR,
      message: "Live failure",
    });
    expect(await runner.isRunning({ threadId })).toBe(false);
    await running;
  } finally {
    source.complete();
    await running;
  }
});
