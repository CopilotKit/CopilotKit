import { afterEach, describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentResult } from "@ag-ui/client";
import { RUNTIME_MODE_INTELLIGENCE } from "@copilotkit/shared";
import { CopilotKitCore } from "../core";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import { startFakeThreadGateway } from "./helpers/fake-thread-gateway";

/**
 * Stop, then a quick follow-up, through the real `phoenix` client and real
 * sockets. Only `setTimeout` is faked, so the stop's 5 s fallback and
 * Phoenix's 10 s push timeout can be passed without waiting for them; network
 * I/O stays real and is waited on with `setImmediate`.
 */

const THREAD_ID = "thread-1";

async function waitUntil(
  condition: () => boolean,
  description: string,
  budgetMs = 3_000,
): Promise<void> {
  const deadline = performance.now() + budgetMs;
  while (!condition()) {
    if (performance.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    // Run timers that are due now, without moving the fake clock.
    await vi.advanceTimersByTimeAsync(0);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Lets frames already on the wire arrive, in real time. */
async function settleNetwork(ms = 200): Promise<void> {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function track(promise: Promise<RunAgentResult>) {
  const state: { result?: RunAgentResult; error?: unknown; settled: boolean } =
    { settled: false };
  promise.then(
    (result) => Object.assign(state, { result, settled: true }),
    (error: unknown) => Object.assign(state, { error, settled: true }),
  );
  return state;
}

let gateway: Awaited<ReturnType<typeof startFakeThreadGateway>> | undefined;

afterEach(async () => {
  vi.useRealTimers();
  await gateway?.close();
  gateway = undefined;
});

/**
 * Run A streams and is stopped, follow-up run B starts on the same agent
 * `startsAfterStopMs` later, and the clock is then moved past both of A's
 * stop timers.
 */
async function stopThenFollowUp(startsAfterStopMs: number) {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout"],
    shouldClearNativeTimers: true,
  });
  const fake = await startFakeThreadGateway();
  gateway = fake;
  const agent = new ProxiedCopilotRuntimeAgent({
    runtimeUrl: fake.runtimeUrl,
    agentId: "default",
    runtimeMode: RUNTIME_MODE_INTELLIGENCE,
    intelligence: { wsUrl: fake.wsUrl },
  });
  agent.threadId = THREAD_ID;
  const core = new CopilotKitCore({});
  core.addAgent__unsafe_dev_only({ id: "default", agent });
  const received: BaseEvent[] = [];
  agent.subscribe({
    onEvent: ({ event }) => {
      received.push(event);
    },
  });

  const runA = track(core.runAgent({ agent, runId: "run-a" }));
  await waitUntil(() => fake.isJoined("run-a"), "run A to join");
  fake.emit("run-a", {
    type: EventType.RUN_STARTED,
    threadId: THREAD_ID,
    runId: "run-a",
  } as BaseEvent);
  fake.emit("run-a", {
    type: EventType.TEXT_MESSAGE_START,
    messageId: "reply-a",
    role: "assistant",
  } as BaseEvent);
  fake.emit("run-a", {
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId: "reply-a",
    delta: "A long answer that the user",
  } as BaseEvent);
  await waitUntil(
    () => received.some((event) => event.type === "TEXT_MESSAGE_CONTENT"),
    "run A to stream",
  );

  core.stopAgent({ agent });
  await waitUntil(() => runA.settled, "run A to end after Stop");
  await waitUntil(
    () => fake.stops.includes("run-a"),
    "the stop to reach the gateway",
  );

  await vi.advanceTimersByTimeAsync(startsAfterStopMs);
  const runB = track(core.runAgent({ agent, runId: "run-b" }));
  await waitUntil(() => fake.isJoined("run-b"), "run B to join");

  // Past the stop's 5 s fallback and Phoenix's 10 s push timeout.
  await vi.advanceTimersByTimeAsync(10_500 - startsAfterStopMs);
  await settleNetwork();

  const streamB = () => {
    fake.emit("run-b", {
      type: EventType.RUN_STARTED,
      threadId: THREAD_ID,
      runId: "run-b",
    } as BaseEvent);
    fake.emit("run-b", {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "reply-b",
      role: "assistant",
    } as BaseEvent);
    fake.emit("run-b", {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "reply-b",
      delta: "Here is the follow-up answer.",
    } as BaseEvent);
  };

  return { fake, agent, core, received, runB, streamB };
}

// A stop settles on the gateway's reply, a 5 s fallback, or Phoenix's 10 s
// push timeout. Under the proxy the reply never reaches the client, so the two
// timers settle it, and a follow-up must survive whichever fires after it.
const followUpStarts = [
  { startsAfterStopMs: 0, label: "before the 5 s fallback" },
  {
    startsAfterStopMs: 6_000,
    label: "between the fallback and the 10 s push timeout",
  },
];

describe("Intelligence stop followed by a quick follow-up", () => {
  it.each(followUpStarts)(
    "keeps a follow-up started $label",
    async ({ startsAfterStopMs }) => {
      const { fake, agent, received, runB, streamB } =
        await stopThenFollowUp(startsAfterStopMs);

      expect(
        fake.timeline.filter((entry) => entry.startsWith("run-b")),
      ).toEqual(["run-b run requested", "run-b phx_join"]);
      expect(fake.isJoined("run-b")).toBe(true);

      // B's events still reach the subscriber, and B finishes.
      const eventsBeforeB = received.length;
      streamB();
      fake.emit("run-b", {
        type: EventType.TEXT_MESSAGE_END,
        messageId: "reply-b",
      } as BaseEvent);
      fake.emit("run-b", {
        type: EventType.RUN_FINISHED,
        threadId: THREAD_ID,
        runId: "run-b",
      } as BaseEvent);
      await waitUntil(() => runB.settled, "run B to finish");

      expect(runB.error).toBeUndefined();
      expect(received.slice(eventsBeforeB).map((event) => event.type)).toEqual([
        "RUN_STARTED",
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
        "RUN_FINISHED",
      ]);
      expect(
        agent.messages.find((message) => message.id === "reply-b")?.content,
      ).toBe("Here is the follow-up answer.");
      expect(agent.isRunning).toBe(false);
    },
  );

  it.each(followUpStarts)(
    "still sends Stop for a follow-up started $label",
    async ({ startsAfterStopMs }) => {
      const { fake, core, agent, received, runB, streamB } =
        await stopThenFollowUp(startsAfterStopMs);

      streamB();
      await waitUntil(
        () =>
          received.some(
            (event) =>
              event.type === "TEXT_MESSAGE_CONTENT" &&
              (event as { messageId?: string }).messageId === "reply-b",
          ),
        "run B to stream",
      );

      core.stopAgent({ agent });
      await waitUntil(() => runB.settled, "run B to end after Stop");
      await waitUntil(
        () => fake.stops.length === 2,
        "the second stop to reach the gateway",
      );

      expect(fake.stops).toEqual(["run-a", "run-b"]);
    },
  );
});
