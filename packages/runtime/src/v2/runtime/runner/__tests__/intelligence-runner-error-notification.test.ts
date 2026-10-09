import { expect, test, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  BaseEvent,
  RunAgentInput,
  RunAgentResult,
  RunErrorEvent,
} from "@ag-ui/client";
import { EMPTY, firstValueFrom, toArray } from "rxjs";
import {
  MockChannel,
  MockSocket,
} from "../../../../../../core/src/__tests__/test-utils";

/** Create an isolated runner with acknowledged persistence and an erroring agent. */
async function setup(throwAfterEvent: boolean, omitTerminal = false) {
  vi.resetModules();
  const channel = new MockChannel("runner:thread");
  const errorEvent: RunErrorEvent = {
    type: EventType.RUN_ERROR,
    message: "private-agent-diagnostic",
    code: "PRIVATE_AGENT_CODE",
  };
  class RunnerChannel extends MockChannel {
    state = "joined";
    push(event: string, payload: unknown) {
      const push = channel.push(event, payload);
      queueMicrotask(() => push.trigger("ok"));
      return push;
    }
  }
  const runnerChannel = new RunnerChannel();
  class RunnerSocket extends MockSocket {
    channel() {
      return runnerChannel;
    }
    isConnected() {
      return this.connected && !this.disconnected;
    }
  }
  class ErrorAgent extends AbstractAgent {
    async runAgent(
      _input: RunAgentInput,
      subscriber?: { onEvent?: (arg: { event: BaseEvent }) => void },
    ): Promise<RunAgentResult> {
      if (!omitTerminal) subscriber?.onEvent?.({ event: errorEvent });
      if (throwAfterEvent) throw new Error("secondary-private-diagnostic");
      return { result: undefined, newMessages: [] };
    }
    run() {
      return EMPTY;
    }
  }
  vi.doMock("phoenix", () => ({ Socket: RunnerSocket }));
  const { IntelligenceAgentRunner } = await import("../intelligence");
  const runner = new IntelligenceAgentRunner({ url: "ws://localhost/runner" });
  const input: RunAgentInput = {
    threadId: "thread",
    runId: "run",
    messages: [],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  };
  const teardown = () => {
    vi.doUnmock("phoenix");
    vi.resetModules();
  };
  return {
    runner,
    input,
    agent: new ErrorAgent(),
    channel,
    runnerChannel,
    errorEvent,
    teardown,
  };
}

test.each([false, true])(
  "notifies the subscriber once for an agent RUN_ERROR without duplicate persistence (throws afterward: %s)",
  async (throwAfterEvent) => {
    const fixture = await setup(throwAfterEvent);
    try {
      const eventsPromise = firstValueFrom(
        fixture.runner
          .run({
            threadId: fixture.input.threadId,
            input: fixture.input,
            agent: fixture.agent,
          })
          .pipe(toArray()),
      );
      fixture.runnerChannel.triggerJoin("ok");
      const events = await eventsPromise;

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject(fixture.errorEvent);
      const persistedErrors = fixture.channel.pushLog.filter(
        ({ payload }) => payload.type === EventType.RUN_ERROR,
      );
      expect(persistedErrors).toHaveLength(1);
      expect(persistedErrors[0].payload).toMatchObject(events[0]);
    } finally {
      fixture.teardown();
    }
  },
);

test("notifies subscribers of a synthesized incomplete-stream error", async () => {
  const fixture = await setup(false, true);
  try {
    const result = firstValueFrom(
      fixture.runner
        .run({
          threadId: fixture.input.threadId,
          input: fixture.input,
          agent: fixture.agent,
        })
        .pipe(toArray()),
    );
    fixture.runnerChannel.triggerJoin("ok");
    const events = await result;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: EventType.RUN_ERROR,
      code: "INCOMPLETE_STREAM",
    });
    expect(
      fixture.channel.pushLog.filter(
        ({ payload }) => payload.type === EventType.RUN_ERROR,
      ),
    ).toHaveLength(1);
  } finally {
    fixture.teardown();
  }
});
