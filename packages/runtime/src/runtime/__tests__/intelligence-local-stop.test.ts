import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable, Subject } from "rxjs";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCopilotKitRuntimeHandler } from "../core/fetch-handler";
import { CopilotIntelligenceRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform/client";
import { STOP_RECORD_DEADLINE_MS } from "../runner/intelligence";
import { startFakeIntelligence } from "./helpers/fake-intelligence";
import type { ConnectMode, StopMode } from "./helpers/fake-intelligence";

/**
 * A run the runtime stops itself (its stop route, or a server-side caller of
 * `runner.stop`) never passes through Intelligence. Intelligence's gateway
 * counts a run as cancelled only when its own stop record names the run when
 * the terminal event arrives, so the runtime records the stop the way a
 * browser's Stop does (`stop_run` on the thread's client channel) before it
 * sends the terminal event.
 *
 * The real runtime, runner and Phoenix client run against a fake Intelligence
 * on 127.0.0.1 that serves the REST API, the runner socket and the client
 * socket on one port and logs what arrives, in order.
 */

const threadId = "550e8400-e29b-41d4-a716-446655440000";
const runId = "run-1";

/** Starts a run and keeps producing until the test finishes it. */
const outputs: Subject<BaseEvent>[] = [];

class ControlledAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    const output = new Subject<BaseEvent>();
    outputs.push(output);
    return new Observable<BaseEvent>((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      return output.subscribe(subscriber);
    });
  }
}

let fake: Awaited<ReturnType<typeof startFakeIntelligence>>;
const previousTelemetrySetting = process.env.COPILOTKIT_TELEMETRY_DISABLED;
const needsWebSocket = typeof globalThis.WebSocket === "undefined";

beforeEach(() => {
  process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";
  // Node 20 has no global WebSocket; Node 22+ uses its native one.
  if (needsWebSocket) vi.stubGlobal("WebSocket", WebSocket);
});

afterEach(async () => {
  for (const output of outputs.splice(0)) output.complete();
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

/** Starts one run through the real runtime and waits for its first event. */
async function startRun(options: { connect: ConnectMode; stop: StopMode }) {
  fake = await startFakeIntelligence(options);
  const runtime = new CopilotIntelligenceRuntime({
    agents: { test: new ControlledAgent({ threadId }) },
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
  expect(response.status).toBe(200);
  await vi.waitFor(() =>
    expect(fake.timeline).toContain(`runner ${EventType.RUN_STARTED}`),
  );
  return {
    handler,
    stop: async () => {
      const started = Date.now();
      const stopped = await handler(
        post(`/agent/test/stop/${threadId}`, { runId }),
      );
      return {
        body: (await stopped.json()) as { stopped: boolean },
        elapsedMs: Date.now() - started,
      };
    },
  };
}

const terminal = `runner ${EventType.RUN_FINISHED}`;

describe("a run the runtime stops itself", () => {
  it("records the stop with Intelligence before the terminal event", async () => {
    const run = await startRun({ connect: "ok", stop: "ok" });

    const { body } = await run.stop();

    expect(body.stopped).toBe(true);
    expect(fake.connectBodies).toEqual([{ userId: "user-1", agentId: "test" }]);
    const stopAt = fake.timeline.indexOf(`stop_run ${runId}`);
    expect(stopAt).toBeGreaterThan(-1);
    expect(
      fake.timeline.indexOf(`client join thread:${threadId}`),
    ).toBeLessThan(stopAt);
    expect(fake.timeline.indexOf(terminal)).toBeGreaterThan(stopAt);
  });

  it("still stops at once when Intelligence refuses the join token", async () => {
    const run = await startRun({ connect: "http-error", stop: "ok" });

    const { body, elapsedMs } = await run.stop();

    expect(body.stopped).toBe(true);
    expect(fake.timeline).toContain("POST /connect");
    expect(fake.timeline).not.toContain(`stop_run ${runId}`);
    expect(fake.timeline).toContain(terminal);
    expect(elapsedMs).toBeLessThan(STOP_RECORD_DEADLINE_MS);
  });

  it("still stops at once when Intelligence refuses the stop", async () => {
    const run = await startRun({ connect: "ok", stop: "error" });

    const { body, elapsedMs } = await run.stop();

    expect(body.stopped).toBe(true);
    const stopAt = fake.timeline.indexOf(`stop_run ${runId}`);
    expect(stopAt).toBeGreaterThan(-1);
    expect(fake.timeline.indexOf(terminal)).toBeGreaterThan(stopAt);
    expect(elapsedMs).toBeLessThan(STOP_RECORD_DEADLINE_MS);
  });

  it("stops within the deadline when Intelligence never answers the stop", async () => {
    const run = await startRun({ connect: "ok", stop: "silent" });

    const { body, elapsedMs } = await run.stop();

    expect(body.stopped).toBe(true);
    expect(fake.timeline).toContain(terminal);
    expect(elapsedMs).toBeGreaterThanOrEqual(STOP_RECORD_DEADLINE_MS - 50);
    expect(elapsedMs).toBeLessThan(STOP_RECORD_DEADLINE_MS + 2_000);
  });
});

describe("runs that need no stop record", () => {
  it("sends none when the run finishes normally", async () => {
    await startRun({ connect: "ok", stop: "ok" });

    outputs[0]!.next({
      type: EventType.RUN_FINISHED,
      threadId,
      runId,
    } as BaseEvent);
    outputs[0]!.complete();

    await vi.waitFor(() => expect(fake.timeline).toContain(terminal));
    expect(fake.timeline).not.toContain("POST /connect");
    expect(fake.timeline).not.toContain(`stop_run ${runId}`);
  });

  it("sends none when Intelligence relayed the stop itself", async () => {
    await startRun({ connect: "ok", stop: "ok" });

    fake.relayGatewayStop(runId);

    await vi.waitFor(() => expect(fake.timeline).toContain(terminal));
    expect(fake.timeline).not.toContain("POST /connect");
    expect(fake.timeline).not.toContain(`stop_run ${runId}`);
  });
});
