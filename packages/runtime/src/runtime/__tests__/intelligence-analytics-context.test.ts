import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { logger } from "@copilotkit/shared";
import { Observable, of } from "rxjs";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import { CopilotIntelligenceRuntime, CopilotSseRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform/client";
import { IntelligenceAgentRunner } from "../runner/intelligence";

/**
 * An app passes its analytics context as
 * `forwardedProps.__copilotkitAnalyticsContext`. The runtime forwards it as
 * `analyticsContext` on the Intelligence thread lock request, and nowhere else.
 *
 * Everything below runs the real runtime against a fake Intelligence API
 * served over HTTP on 127.0.0.1, so the lock body asserted on is the one the
 * runtime actually put on the wire.
 */

interface ContextFixture {
  valid: { name: string; context: Record<string, unknown> }[];
  invalid: { name: string; context: unknown }[];
}

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/app-analytics-context-v1.json", import.meta.url),
    "utf8",
  ),
) as ContextFixture;

const humanRun = fixture.valid[0]!.context;
const notAnObject = fixture.invalid.find(
  (entry) => entry.name === "not an object",
)!.context;

const KEY = "__copilotkitAnalyticsContext";
const threadId = "550e8400-e29b-41d4-a716-446655440000";

interface CapturedRequest {
  method: string;
  path: string;
  body: unknown;
}

/** The Intelligence endpoints one run touches, recording every request. */
async function startFakeIntelligence() {
  const requests: CapturedRequest[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body: unknown = raw ? JSON.parse(raw) : undefined;
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = req.method ?? "GET";
    requests.push({ method, path: url.pathname, body });

    const send = (status: number, payload?: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(payload === undefined ? "" : JSON.stringify(payload));
    };
    const match = url.pathname.match(/^\/api\/threads\/([^/]+)(\/[^/]+)?$/);
    if (!match) return send(404, { error: "not found" });
    const [, id, rest] = match;
    if (method === "GET" && rest === undefined) {
      return send(200, { thread: { id, name: "Existing" } });
    }
    if (method === "GET" && rest === "/messages") {
      return send(200, { messages: [] });
    }
    if (rest === "/lock" && method === "POST") {
      return send(200, {
        threadId: id,
        runId: (body as { runId: string }).runId,
        joinToken: "join-token",
        ttlSeconds: 120,
      });
    }
    if (rest === "/lock" && method === "PATCH") {
      return send(200, { ttlSeconds: 120, status: "renewed" });
    }
    if (rest === "/lock" && method === "DELETE") return send(204);
    return send(404, { error: "not found" });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    lockBodies: () =>
      requests
        .filter((r) => r.method === "POST" && r.path.endsWith("/lock"))
        .map((r) => r.body as Record<string, unknown>),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** What each agent run was handed, after the runtime's middleware. */
const agentInputs: RunAgentInput[] = [];

class RecordingAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    agentInputs.push(input);
    return of(
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent,
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent,
    );
  }
}

let fake: Awaited<ReturnType<typeof startFakeIntelligence>>;
const previousTelemetrySetting = process.env.COPILOTKIT_TELEMETRY_DISABLED;

beforeAll(async () => {
  process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";
  fake = await startFakeIntelligence();
});

afterAll(async () => {
  await fake.close();
  if (previousTelemetrySetting === undefined) {
    delete process.env.COPILOTKIT_TELEMETRY_DISABLED;
  } else {
    process.env.COPILOTKIT_TELEMETRY_DISABLED = previousTelemetrySetting;
  }
});

beforeEach(() => {
  fake.requests.length = 0;
  agentInputs.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function createClient() {
  return new CopilotKitIntelligence({
    apiKey: "test-key",
    apiUrl: fake.url,
    wsUrl: "ws://127.0.0.1:9",
  });
}

/**
 * A real Intelligence runtime behind the real fetch handler. Only the
 * runner's Phoenix socket is left out: the stub hands `request.input` to
 * `agent.runAgent` exactly as the runner does once its channel joins.
 */
function createIntelligenceHandler() {
  const runtime = new CopilotIntelligenceRuntime({
    agents: { test: new RecordingAgent({ threadId }) },
    intelligence: createClient(),
    identifyUser: () => ({ id: "user-1", name: "User One" }),
    generateThreadNames: false,
  });
  if (!(runtime.runner instanceof IntelligenceAgentRunner)) {
    throw new Error("Expected the Intelligence runner");
  }
  const runnerInputs: RunAgentInput[] = [];
  vi.spyOn(runtime.runner, "runWithStartupBoundary").mockImplementation(
    (request) => {
      runnerInputs.push(request.input);
      return {
        events: new Observable<BaseEvent>((subscriber) => {
          request.agent.runAgent(request.input).then(
            () => subscriber.complete(),
            (error: unknown) => subscriber.error(error),
          );
        }),
        startup: Promise.resolve(),
      };
    },
  );
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
  });
  return { handler, runnerInputs };
}

function runBody(forwardedProps: Record<string, unknown>) {
  return {
    threadId,
    runId: "run-1",
    messages: [{ id: "msg-1", role: "user", content: "Hello" }],
    tools: [],
    context: [],
    state: {},
    forwardedProps,
  };
}

function post(path: string, body: unknown) {
  return new Request(`http://127.0.0.1/api/copilotkit${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Runs one browser-style turn and returns what the agent was handed. */
async function browserRun(forwardedProps: Record<string, unknown>) {
  const { handler, runnerInputs } = createIntelligenceHandler();
  const response = await handler(
    post("/agent/test/run", runBody(forwardedProps)),
  );
  expect(response.status).toBe(200);
  await vi.waitFor(() => expect(agentInputs).toHaveLength(1));
  return { agentInput: agentInputs[0]!, runnerInput: runnerInputs[0]! };
}

function headlessLock(analyticsContext: unknown) {
  return createClient().ɵacquireThreadLock({
    threadId,
    runId: "run-1",
    userId: "user-1",
    agentId: "test",
    ttlSeconds: 120,
    analyticsContext: analyticsContext as Record<string, unknown>,
  });
}

describe("browser runs", () => {
  it.each(fixture.valid)(
    "sends the context on the lock request: $name",
    async ({ context }) => {
      const { agentInput, runnerInput } = await browserRun({
        __copilotkitRequestId: "req-1",
        appSetting: "kept",
        [KEY]: context,
      });

      const [lock] = fake.lockBodies();
      expect(lock).toMatchObject({ requestId: "req-1" });
      expect(lock!.analyticsContext).toEqual(context);

      // The agent, and the input the runner records as the run's start, keep
      // every other forwarded prop but never the context.
      for (const input of [agentInput, runnerInput]) {
        expect(input.forwardedProps).toMatchObject({
          __copilotkitRequestId: "req-1",
          appSetting: "kept",
        });
        expect(input.forwardedProps).not.toHaveProperty(KEY);
      }

      // The lock request is the only place the context goes.
      const carriers = fake.requests.filter((r) =>
        JSON.stringify(r.body ?? null).includes(String(context.app_user_hash)),
      );
      expect(carriers.map((r) => `${r.method} ${r.path}`)).toEqual([
        `POST /api/threads/${threadId}/lock`,
      ]);
    },
  );

  it("sends no context when the app sends none", async () => {
    const { agentInput } = await browserRun({ appSetting: "kept" });

    const [lock] = fake.lockBodies();
    expect(lock).not.toHaveProperty("analyticsContext");
    expect(agentInput.forwardedProps).toEqual({ appSetting: "kept" });
  });

  it.each([
    ["a string (fixture: not an object)", notAnObject],
    ["an array", [humanRun]],
    ["a number", 42],
    ["a boolean", true],
  ])("drops a context that is %s and still runs", async (_label, malformed) => {
    const warn = vi.spyOn(logger, "warn");
    const { agentInput } = await browserRun({ [KEY]: malformed });

    const [lock] = fake.lockBodies();
    expect(lock).not.toHaveProperty("analyticsContext");
    expect(agentInput.forwardedProps).not.toHaveProperty(KEY);
    expect(warn).toHaveBeenCalledWith(
      { problem: "not a plain object" },
      expect.stringContaining("analytics context"),
    );
  });

  it("drops an oversized context and still runs", async () => {
    const warn = vi.spyOn(logger, "warn");
    const { agentInput } = await browserRun({
      [KEY]: { ...humanRun, padding: "x".repeat(5_000) },
    });

    const [lock] = fake.lockBodies();
    expect(lock).not.toHaveProperty("analyticsContext");
    expect(agentInput.forwardedProps).not.toHaveProperty(KEY);
    // The warning names the problem, never the content.
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("larger than 4096 bytes");
    expect(logged).not.toContain(String(humanRun.app_user_hash));
  });

  it.each(fixture.invalid)(
    "leaves contract validation to Intelligence: $name",
    async ({ name, context }) => {
      await browserRun({ [KEY]: context });

      const [lock] = fake.lockBodies();
      if (name === "not an object") {
        expect(lock).not.toHaveProperty("analyticsContext");
      } else {
        // A plain object is forwarded as the app built it.
        expect(lock!.analyticsContext).toEqual(context);
      }
    },
  );
});

describe("headless lock calls", () => {
  it.each(fixture.valid)(
    "send the context on the lock request: $name",
    async ({ context }) => {
      await headlessLock(context);

      const [lock] = fake.lockBodies();
      expect(lock!.analyticsContext).toEqual(context);
    },
  );

  it("send no context when the caller passes none", async () => {
    await headlessLock(undefined);

    const [lock] = fake.lockBodies();
    expect(lock).toMatchObject({ runId: "run-1", agentId: "test" });
    expect(lock).not.toHaveProperty("analyticsContext");
  });

  const circular: Record<string, unknown> = { ...humanRun };
  circular.self = circular;

  it.each([
    ["a string (fixture: not an object)", notAnObject, "not a plain object"],
    ["null", null, undefined],
    ["an array", [humanRun], "not a plain object"],
    ["a class instance", new Date(0), "not a plain object"],
    ["a map", new Map([["app_id", "openbot"]]), "not a plain object"],
    [
      "an object holding a function",
      { ...humanRun, callback: () => "x" },
      "contains a function",
    ],
    [
      "an object holding a nested function",
      { ...humanRun, nested: { run: () => undefined } },
      "contains a function",
    ],
    [
      "an object holding a symbol",
      { ...humanRun, marker: Symbol("x") },
      "contains a symbol",
    ],
    [
      "an object holding a BigInt",
      { ...humanRun, attempt: BigInt(1) },
      "not serializable as JSON",
    ],
    [
      "an object holding NaN",
      { ...humanRun, attempt: Number.NaN },
      "contains a non-finite number",
    ],
    ["a circular object", circular, "not serializable as JSON"],
  ])(
    "drop a context that is %s and still take the lock",
    async (_label, malformed, problem) => {
      const warn = vi.spyOn(logger, "warn");

      await expect(headlessLock(malformed)).resolves.toMatchObject({
        runId: "run-1",
        joinToken: "join-token",
      });

      const [lock] = fake.lockBodies();
      expect(lock).not.toHaveProperty("analyticsContext");
      if (problem === undefined) {
        expect(warn).not.toHaveBeenCalled();
      } else {
        expect(warn).toHaveBeenCalledWith(
          { problem },
          expect.stringContaining("analytics context"),
        );
      }
    },
  );

  it("measure the 4 KB bound in bytes of serialized JSON", async () => {
    // `{"note":""}` is 11 bytes and "é" is 2 bytes in UTF-8, so this is
    // 11 + 2042 * 2 + 1 = 4096 bytes, though only 2054 characters.
    const atLimit = { note: "é".repeat(2042) + "a" };
    const overLimit = { note: atLimit.note + "a" };
    expect(new TextEncoder().encode(JSON.stringify(atLimit)).byteLength).toBe(
      4096,
    );

    await headlessLock(atLimit);
    await headlessLock(overLimit);

    const [first, second] = fake.lockBodies();
    expect(first!.analyticsContext).toEqual(atLimit);
    expect(second).not.toHaveProperty("analyticsContext");
  });
});

describe("runs that never reach Intelligence", () => {
  function createSseHandler() {
    const runtime = new CopilotSseRuntime({
      agents: { test: new RecordingAgent({ threadId }) },
    });
    return createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit",
    });
  }

  it("keep the context away from an SSE agent", async () => {
    const response = await createSseHandler()(
      post("/agent/test/run", runBody({ appSetting: "kept", [KEY]: humanRun })),
    );
    expect(response.status).toBe(200);
    await response.text();

    expect(agentInputs).toHaveLength(1);
    expect(agentInputs[0]!.forwardedProps).toEqual({ appSetting: "kept" });
    expect(fake.requests).toEqual([]);
  });

  it("keep the context away from a suggestion agent", async () => {
    const response = await createSseHandler()(
      post(
        "/agent/test/suggest",
        runBody({ appSetting: "kept", [KEY]: humanRun }),
      ),
    );
    expect(response.status).toBe(200);
    await response.text();

    expect(agentInputs).toHaveLength(1);
    expect(agentInputs[0]!.forwardedProps).toEqual({ appSetting: "kept" });
  });
});
