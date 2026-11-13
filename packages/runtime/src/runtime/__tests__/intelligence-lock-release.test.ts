import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCopilotKitRuntimeHandler } from "../core/fetch-handler";
import { CopilotIntelligenceRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform/client";
import { startFakeLockGateway } from "./helpers/fake-lock-gateway";
import type { FakeLockGatewayOptions } from "./helpers/fake-lock-gateway";

/**
 * Intelligence's gateway checks a thread's lock each time it stores a batch
 * of runner events, so the runtime must hold the lock until its runner has
 * delivered the run's last events, or has failed to for good. Releasing it
 * earlier gets the runner's next batch refused and loses the end of the run.
 *
 * The real runtime, runner and Phoenix client run against a fake Intelligence
 * on 127.0.0.1 that keeps the lock as app-api and the gateway do. The gateway
 * takes GATEWAY_STORE_MS to store each batch, as the network and Redis take
 * time between the runner sending a batch and the lock check deciding it.
 */

const threadId = "550e8400-e29b-41d4-a716-446655440000";
const runId = "run-1";
const GATEWAY_STORE_MS = 100;

/** The events the next run's agent produces. The runtime clones agents. */
let script: (input: RunAgentInput) => Observable<BaseEvent>;

class ScriptedAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    return script(input);
  }
}

function runStarted(input: RunAgentInput): BaseEvent {
  return {
    type: EventType.RUN_STARTED,
    threadId: input.threadId,
    runId: input.runId,
  } as BaseEvent;
}

function text(deltas: number, end = true): BaseEvent[] {
  return [
    { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" },
    ...Array.from({ length: deltas }, (_, index) => ({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "m1",
      delta: `part ${index} `,
    })),
    ...(end ? [{ type: EventType.TEXT_MESSAGE_END, messageId: "m1" }] : []),
  ] as BaseEvent[];
}

const modelError = {
  type: EventType.RUN_ERROR,
  message: "The model call failed",
  code: "MODEL_CALL_FAILED",
} as BaseEvent;

function emits(events: (input: RunAgentInput) => BaseEvent[]) {
  return (input: RunAgentInput) =>
    new Observable<BaseEvent>((subscriber) => {
      for (const event of events(input)) subscriber.next(event);
      subscriber.complete();
    });
}

/** Emits its events, then keeps the run going until it is stopped. */
function emitsThenWaits(events: (input: RunAgentInput) => BaseEvent[]) {
  return (input: RunAgentInput) =>
    new Observable<BaseEvent>((subscriber) => {
      for (const event of events(input)) subscriber.next(event);
    });
}

let fake: Awaited<ReturnType<typeof startFakeLockGateway>>;
const previousTelemetrySetting = process.env.COPILOTKIT_TELEMETRY_DISABLED;
const needsWebSocket = typeof globalThis.WebSocket === "undefined";

beforeEach(() => {
  process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";
  // Node 20 has no global WebSocket; Node 22+ uses its native one.
  if (needsWebSocket) vi.stubGlobal("WebSocket", WebSocket);
});

afterEach(async () => {
  await fake?.close();
  if (needsWebSocket) vi.unstubAllGlobals();
  if (previousTelemetrySetting === undefined) {
    delete process.env.COPILOTKIT_TELEMETRY_DISABLED;
  } else {
    process.env.COPILOTKIT_TELEMETRY_DISABLED = previousTelemetrySetting;
  }
});

function post(path: string, body: unknown) {
  return new Request(`http://127.0.0.1/api/copilotkit${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Starts one run through the real runtime handler. */
async function startRun(
  agentScript: typeof script,
  gateway: FakeLockGatewayOptions = {},
) {
  fake = await startFakeLockGateway({
    storeDelayMs: GATEWAY_STORE_MS,
    ...gateway,
  });
  script = agentScript;
  const runtime = new CopilotIntelligenceRuntime({
    agents: { test: new ScriptedAgent({ threadId }) },
    intelligence: new CopilotKitIntelligence({
      apiKey: "test-key",
      apiUrl: fake.apiUrl,
      wsUrl: fake.wsUrl,
    }),
    identifyUser: () => ({ id: "user-1", name: "User One" }),
    generateThreadNames: false,
  });
  const handler = createCopilotKitRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
  });
  const response = await handler(
    post("/agent/test/run", {
      threadId,
      runId,
      messages: [{ id: "msg-1", role: "user", content: "Hello" }],
      tools: [],
      context: [],
      state: {},
      forwardedProps: {},
    }),
  );
  return { handler, response };
}

const runtimeRelease = (entry: string) => entry.startsWith("runtime release");
const storedBatches = () =>
  fake.timeline.filter((entry) => entry.startsWith("stored "));
const storedTypes = () => fake.stored.map((event) => event.type);
const isTerminal = (type: string) =>
  type === EventType.RUN_FINISHED || type === EventType.RUN_ERROR;

/**
 * Waits until the runtime has let go of the lock and the gateway has nothing
 * left to store: the run's terminal event is stored, or a batch was refused
 * and the runner gave up.
 */
async function waitForRunToEnd() {
  await vi.waitFor(
    () => {
      expect(fake.timeline.some(runtimeRelease)).toBe(true);
      expect(fake.pendingBatches()).toBe(0);
      expect(
        storedTypes().some(isTerminal) ||
          fake.timeline.some((entry) => entry.startsWith("refused ")),
      ).toBe(true);
    },
    { timeout: 3_000, interval: 10 },
  );
}

/**
 * The run's events all reached the gateway while the run held the lock, the
 * gateway let go of the lock when it stored the terminal event, and the
 * runtime's own release came after that.
 */
function expectLockHeldUntilTerminalStored(terminalType: string) {
  expect(fake.timeline.filter((e) => e.startsWith("refused "))).toEqual([]);
  expect(storedBatches().length).toBeGreaterThan(0);
  for (const batch of storedBatches()) {
    expect(batch).toMatch(/\(lock held\)$/);
  }
  expect(storedTypes().at(-1)).toBe(terminalType);
  const gatewayRelease = fake.timeline.indexOf("gateway released the lock");
  expect(gatewayRelease).toBeGreaterThan(-1);
  expect(fake.timeline.findIndex(runtimeRelease)).toBeGreaterThan(
    gatewayRelease,
  );
  expect(fake.lockOwner(threadId)).toBeUndefined();
}

describe("a run that fails", () => {
  it("holds the lock until the batch carrying its RUN_ERROR is stored", async () => {
    const { response } = await startRun(
      emits((input) => [runStarted(input), ...text(3), modelError]),
    );
    expect(response.status).toBe(200);

    await waitForRunToEnd();

    expectLockHeldUntilTerminalStored(EventType.RUN_ERROR);
    expect(fake.stored.at(-1)).toMatchObject({
      type: EventType.RUN_ERROR,
      message: "The model call failed",
    });
  });

  it("keeps a batch that was still on its way when the agent failed", async () => {
    // 32 events fill one batch, which the runner sends at once. The agent
    // fails while the gateway is still storing it.
    const { response } = await startRun(
      emits((input) => [runStarted(input), ...text(40, false), modelError]),
    );
    expect(response.status).toBe(200);

    await waitForRunToEnd();

    expectLockHeldUntilTerminalStored(EventType.RUN_ERROR);
    expect(
      storedTypes().filter((type) => type === EventType.TEXT_MESSAGE_CONTENT),
    ).toHaveLength(40);
  });
});

describe("a run that finishes", () => {
  it("holds the lock until its RUN_FINISHED is stored", async () => {
    const { response } = await startRun(
      emits((input) => [
        runStarted(input),
        ...text(3),
        {
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
        } as BaseEvent,
      ]),
    );
    expect(response.status).toBe(200);

    await waitForRunToEnd();

    expectLockHeldUntilTerminalStored(EventType.RUN_FINISHED);
  });
});

describe("a run that is stopped", () => {
  it("holds the lock until the stopped run's terminal event is stored after a browser Stop", async () => {
    await startRun(
      emitsThenWaits((input) => [runStarted(input), ...text(2, false)]),
    );
    await vi.waitFor(() => expect(storedBatches().length).toBeGreaterThan(0));

    fake.relayStop(runId);
    await waitForRunToEnd();

    expectLockHeldUntilTerminalStored(EventType.RUN_FINISHED);
  });

  it("holds the lock until the stopped run's terminal event is stored after the runtime's stop route", async () => {
    const { handler } = await startRun(
      emitsThenWaits((input) => [runStarted(input), ...text(2, false)]),
    );
    await vi.waitFor(() => expect(storedBatches().length).toBeGreaterThan(0));

    const stopped = await handler(
      post(`/agent/test/stop/${threadId}`, { runId }),
    );
    expect(((await stopped.json()) as { stopped: boolean }).stopped).toBe(true);
    await waitForRunToEnd();

    expectLockHeldUntilTerminalStored(EventType.RUN_FINISHED);
  });
});

describe("a runner that cannot deliver", () => {
  it("still releases the lock when the gateway refuses its events for good", async () => {
    const { response } = await startRun(
      emitsThenWaits((input) => [runStarted(input), ...text(2, false)]),
      { refuseBatch: 1 },
    );
    expect(response.status).toBe(200);

    await vi.waitFor(() =>
      expect(fake.timeline).toContain("runtime released the lock"),
    );

    expect(fake.timeline.filter((e) => e.startsWith("refused "))).toHaveLength(
      1,
    );
    expect(fake.lockOwner(threadId)).toBeUndefined();
  });

  it("still releases the lock before answering when the runner cannot join", async () => {
    const { response } = await startRun(
      emits((input) => [runStarted(input), ...text(1)]),
      { refuseJoin: true },
    );

    expect(response.status).toBe(502);
    expect(fake.timeline).toContain("runtime released the lock");
    expect(fake.lockOwner(threadId)).toBeUndefined();
    expect(fake.stored).toEqual([]);
  });
});
