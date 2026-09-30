import { expect, test, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { firstValueFrom, of, toArray } from "rxjs";
import {
  MockChannel,
  MockSocket,
} from "../../../../../../core/src/__tests__/test-utils";

/** Exercise the real AG-UI agent input builder and capture runner persistence. */
async function setup() {
  vi.resetModules();
  const channel = new MockChannel("capture");
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
  const received: RunAgentInput[] = [];
  class NativeAgent extends AbstractAgent {
    run(input: RunAgentInput) {
      received.push(input);
      return of(
        {
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
        },
        {
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
        },
      );
    }
  }
  vi.doMock("phoenix", () => ({ Socket: RunnerSocket }));
  const { IntelligenceAgentRunner } = await import("../intelligence");
  const runner = new IntelligenceAgentRunner({ url: "ws://localhost/runner" });
  const input: RunAgentInput = {
    threadId: "550e8400-e29b-41d4-a716-446655440000",
    runId: "run-1",
    messages: [],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  };
  const agent = new NativeAgent({ threadId: input.threadId });
  return {
    runner,
    channel,
    runnerChannel,
    input,
    agent,
    received,
    teardown: () => {
      vi.doUnmock("phoenix");
      vi.resetModules();
    },
  };
}

test.each([undefined, "native/session:with spaces"])(
  "uses backend ID %s only for agent execution and retains Intelligence event ownership",
  async (backendThreadId) => {
    const fixture = await setup();
    try {
      const request = {
        threadId: fixture.input.threadId,
        input: fixture.input,
        agent: fixture.agent,
        ...(backendThreadId === undefined ? {} : { backendThreadId }),
      };
      const done = firstValueFrom(fixture.runner.run(request).pipe(toArray()));
      fixture.runnerChannel.triggerJoin("ok");
      await done;

      expect(fixture.received).toHaveLength(1);
      expect(fixture.received[0].threadId).toBe(
        backendThreadId ?? fixture.input.threadId,
      );
      expect(fixture.input.threadId).toBe(
        "550e8400-e29b-41d4-a716-446655440000",
      );
      const persisted = fixture.channel.pushLog.filter(
        (push) => push.event === "event",
      );
      expect(persisted.length).toBeGreaterThan(0);
      for (const push of persisted) {
        expect(push.payload).toMatchObject({
          threadId: fixture.input.threadId,
          thread_id: fixture.input.threadId,
        });
      }
    } finally {
      fixture.teardown();
    }
  },
);
