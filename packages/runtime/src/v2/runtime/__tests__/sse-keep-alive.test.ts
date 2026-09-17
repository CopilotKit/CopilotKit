import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEVER, Subject } from "rxjs";
import type { AbstractAgent, BaseEvent } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import {
  keepAliveSse,
  MAX_SSE_KEEP_ALIVE_INTERVAL_SECONDS,
} from "../handlers/shared/sse-keep-alive";
import { createSseEventResponse } from "../handlers/shared/sse-response";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import { CopilotRuntime } from "../core/runtime";
import type { AgentRunner } from "../runner/agent-runner";

vi.mock("../telemetry", () => ({ telemetry: { capture: vi.fn() } }));

const KEEP_ALIVE = ": keep-alive\n\n";
const decoder = new TextDecoder();
const bytes = (text: string) => new TextEncoder().encode(text);

/** Source stream plus a reader on the keep-alive wrapped output. */
const setup = (idleMs = 1_000) => {
  const source = new TransformStream<Uint8Array, Uint8Array>();
  const writer = source.writable.getWriter();
  const reader = keepAliveSse(source.readable, idleMs).getReader();
  const next = async () => decoder.decode((await reader.read()).value);
  return { writer, reader, next };
};

describe("keepAliveSse", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes a comment after each idle interval on a quiet stream", async () => {
    const { next } = setup();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await next()).toBe(KEEP_ALIVE);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await next()).toBe(KEEP_ALIVE);
  });

  it("adds nothing while the source keeps writing", async () => {
    const { writer, next } = setup();
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(600);
      await writer.write(bytes(`data: ${i}\n\n`));
      expect(await next()).toBe(`data: ${i}\n\n`);
    }
    expect(vi.getTimerCount()).toBe(1);
  });

  it("skips the tick while the reader still holds the previous chunk", async () => {
    const { writer, next } = setup();
    await writer.write(bytes("data: x\n\n"));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await next()).toBe("data: x\n\n");
    // Three ticks passed unread; none may sit behind that chunk.
    let settled = false;
    const pending = next().then((chunk) => {
      settled = true;
      return chunk;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toBe(KEEP_ALIVE);
  });

  it("stops the timer when the source completes", async () => {
    const { writer, reader } = setup();
    await writer.close();
    expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops the timer and cancels the source when the reader cancels", async () => {
    const { writer, reader } = setup();
    const reason = new Error("client went away");
    await reader.cancel(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await expect(writer.write(bytes("late"))).rejects.toBe(reason);
  });
});

describe("createSseEventResponse keep-alive", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const respond = (keepAliveIntervalSeconds?: number) => {
    const events = new Subject<BaseEvent>();
    const response = createSseEventResponse({
      request: new Request("http://localhost/run"),
      observableFactory: () => events,
      keepAliveIntervalSeconds,
    });
    return { events, reader: response.body!.getReader() };
  };

  it("keeps a quiet run alive and preserves event order", async () => {
    const { events, reader } = respond(1);
    const first = reader.read();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(decoder.decode((await first).value)).toBe(KEEP_ALIVE);
    events.next({ type: EventType.RUN_STARTED, threadId: "t", runId: "r" });
    expect(decoder.decode((await reader.read()).value)).toContain(
      '"type":"RUN_STARTED"',
    );
    events.complete();
    expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("writes nothing extra when disabled with 0", async () => {
    const { events, reader } = respond(0);
    await vi.advanceTimersByTimeAsync(60_000);
    events.next({ type: EventType.RUN_STARTED, threadId: "t", runId: "r" });
    expect(decoder.decode((await reader.read()).value)).toContain(
      '"type":"RUN_STARTED"',
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});

const postAgent = (path: string, body: unknown) =>
  new Request(`http://localhost/api/copilotkit/agent/default/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// Real timers below: the run handler awaits work that faked timers never release.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runtime option on the wire", () => {
  const quietRunner = {
    run: () => NEVER,
    connect: () => NEVER,
    isRunning: async () => false,
    stop: async () => false,
  } as unknown as AgentRunner;
  const agent = {
    clone() {
      return this;
    },
    setMessages() {},
    setState() {},
  } as unknown as AbstractAgent;
  const handlerFor = (sseKeepAliveIntervalSeconds: number) =>
    createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({
        agents: { default: agent },
        runner: quietRunner,
        sseKeepAliveIntervalSeconds,
      }),
      basePath: "/api/copilotkit",
    });
  const runInput = {
    threadId: "t1",
    runId: "r1",
    state: {},
    messages: [],
    tools: [],
    context: [],
    forwardedProps: {},
  };

  it.each(["run", "connect"])(
    "POST /%s carries the configured keep-alive",
    async (path) => {
      const response = await handlerFor(0.05)(postAgent(path, runInput));
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      expect(decoder.decode((await reader.read()).value)).toBe(KEEP_ALIVE);
      void reader.cancel();
    },
  );

  it("POST /run stays silent when the runtime disables it", async () => {
    const response = await handlerFor(0)(postAgent("run", runInput));
    const reader = response.body!.getReader();
    let settled = false;
    const first = reader.read().then(() => {
      settled = true;
    });
    await sleep(200);
    expect(settled).toBe(false);
    void reader.cancel();
    void first;
  });
});

describe("CopilotRuntime sseKeepAliveIntervalSeconds", () => {
  it("defaults to 15 seconds", () => {
    expect(new CopilotRuntime({ agents: {} }).sseKeepAliveIntervalSeconds).toBe(
      15,
    );
  });

  it("accepts 0 to disable", () => {
    expect(
      new CopilotRuntime({ agents: {}, sseKeepAliveIntervalSeconds: 0 })
        .sseKeepAliveIntervalSeconds,
    ).toBe(0);
  });

  it("accepts the longest interval a timer can honour", () => {
    expect(
      new CopilotRuntime({
        agents: {},
        sseKeepAliveIntervalSeconds: MAX_SSE_KEEP_ALIVE_INTERVAL_SECONDS,
      }).sseKeepAliveIntervalSeconds,
    ).toBe(MAX_SSE_KEEP_ALIVE_INTERVAL_SECONDS);
  });

  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    MAX_SSE_KEEP_ALIVE_INTERVAL_SECONDS + 0.001,
  ])("rejects %s at construction", (value) => {
    expect(
      () =>
        new CopilotRuntime({
          agents: {},
          sseKeepAliveIntervalSeconds: value,
        }),
    ).toThrow(RangeError);
  });
});
