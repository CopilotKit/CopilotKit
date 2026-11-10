import { afterEach, describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/core";
import type {
  IncomingTurn,
  IngressSink,
  InteractionEvent,
} from "@copilotkit/channels-core";
import { Message, Section, renderToIR } from "@copilotkit/channels-ui";
import { web } from "../adapter.js";
import type { WebAdapter } from "../adapter.js";
import type { WebReplyTarget } from "../types.js";
import { readEvents } from "./helpers.js";

type Gate = { release: () => void; promise: Promise<void> };
function gate(): Gate {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, promise };
}

function sink(overrides: Partial<IngressSink> = {}): IngressSink {
  return {
    onTurn: vi.fn(),
    onInteraction: vi.fn(),
    onWelcome: vi.fn(),
    onCommand: vi.fn(),
    onThreadStarted: vi.fn(),
    onReaction: vi.fn(),
    onModalSubmit: vi.fn(async () => undefined),
    onModalClose: vi.fn(),
    ...overrides,
  };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    threadId: "t1",
    runId: "r1",
    messages: [{ id: "u1", role: "user", content: "hi" }],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
    ...overrides,
  };
}

function post(
  json: unknown,
  init: { headers?: Record<string, string>; signal?: AbortSignal } = {},
): Request {
  return new Request("https://app.test/api/channel", {
    method: "POST",
    headers: { "content-type": "application/json", ...init.headers },
    body: JSON.stringify(json),
    signal: init.signal,
  });
}

async function* chunks() {
  yield "Hel";
  yield "";
  yield "lo";
}

let adapter: WebAdapter | undefined;
afterEach(async () => {
  await adapter?.stop();
  adapter = undefined;
  vi.restoreAllMocks();
});

describe("WebAdapter.handler", () => {
  it("answers 503 before the channel starts", async () => {
    adapter = web();
    const res = await adapter.handler(post(body()));
    expect(res.status).toBe(503);
  });

  it("answers 405 for GET and 400 for an invalid body", async () => {
    adapter = web();
    await adapter.start(sink());
    const get = await adapter.handler(new Request("https://app.test/x"));
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST, OPTIONS");

    const bad = await adapter.handler(post({ nope: true }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({
      error: "body is not a valid AG-UI RunAgentInput",
    });
  });

  it("works as a detached function, for `export const POST = adapter.handler`", async () => {
    adapter = web();
    await adapter.start(sink());
    const { handler } = adapter;
    const res = await handler(post(body()));
    expect(res.status).toBe(200);
    await res.text();
  });

  it("answers 401 when getUser throws", async () => {
    adapter = web({
      getUser: () => {
        throw new Error("no session");
      },
    });
    const onTurn = vi.fn();
    await adapter.start(sink({ onTurn }));
    const res = await adapter.handler(post(body()));
    expect(res.status).toBe(401);
    expect(onTurn).not.toHaveBeenCalled();
  });

  it("routes a turn with the resolved user and wraps it in one run lifecycle", async () => {
    adapter = web({
      getUser: (req) => ({ id: req.headers.get("x-user") ?? "?", name: "Ada" }),
    });
    const turns: IncomingTurn[] = [];
    await adapter.start(sink({ onTurn: (t) => void turns.push(t) }));

    const res = await adapter.handler(
      post(body(), { headers: { "x-user": "u-9" } }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect((await readEvents(res)).map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
    expect(turns[0]).toMatchObject({
      conversationKey: "t1",
      userText: "hi",
      actor: { id: "u-9", kind: "human", name: "Ada" },
    });
  });

  it("streams SSE for Accept */* and protobuf only when the client asks for it", async () => {
    adapter = web();
    await adapter.start(sink());
    const any = await adapter.handler(
      post(body(), { headers: { accept: "*/*" } }),
    );
    expect(any.headers.get("content-type")).toBe("text/event-stream");
    await any.text();
    const proto = await adapter.handler(
      post(body({ runId: "r2" }), {
        headers: { accept: "application/vnd.ag-ui.event+proto" },
      }),
    );
    expect(proto.headers.get("content-type")).toBe(
      "application/vnd.ag-ui.event+proto",
    );
    await proto.arrayBuffer();
  });

  it("routes channelInteraction to onInteraction", async () => {
    adapter = web();
    const clicks: InteractionEvent[] = [];
    await adapter.start(sink({ onInteraction: (e) => void clicks.push(e) }));
    const res = await adapter.handler(
      post(
        body({
          forwardedProps: { channelInteraction: { id: "ck:1", value: 2 } },
        }),
      ),
    );
    await readEvents(res);
    expect(clicks[0]).toMatchObject({
      id: "ck:1",
      value: 2,
      conversationKey: "t1",
    });
  });

  it("answers CORS preflight and tags responses for allowed origins only", async () => {
    adapter = web({ allowedOrigins: ["https://site.test"] });
    await adapter.start(sink());
    const preflight = await adapter.handler(
      new Request("https://app.test/api/channel", {
        method: "OPTIONS",
        headers: { origin: "https://site.test" },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      "https://site.test",
    );
    const other = await adapter.handler(
      post(body(), { headers: { origin: "https://evil.test" } }),
    );
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    await readEvents(other);
  });
});

describe("WebAdapter output", () => {
  /** Start a request whose turn stays open until the gate is released. */
  async function openTurn(threadId = "t1", runId = "r1") {
    const hold = gate();
    let target!: WebReplyTarget;
    const turnSeen = gate();
    adapter ??= web();
    await adapter.start(
      sink({
        onTurn: async (turn) => {
          target = turn.replyTarget as WebReplyTarget;
          turnSeen.release();
          await hold.promise;
        },
      }),
    );
    const res = await adapter.handler(post(body({ threadId, runId })));
    await turnSeen.promise;
    return { res, target, hold };
  }

  it("encodes a post as a text message plus a channels.ui event", async () => {
    const { res, target, hold } = await openTurn();
    const ref = await adapter!.post(
      target,
      renderToIR(Message({ children: Section({ children: "Hi there" }) })),
    );
    hold.release();
    const events = await readEvents(res);

    expect(events.map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.CUSTOM,
      EventType.RUN_FINISHED,
    ]);
    expect(events[2]).toMatchObject({ messageId: ref.id, delta: "Hi there" });
    expect(events[4]).toMatchObject({
      name: "channels.ui",
      value: {
        messageId: ref.id,
        ir: [{ type: "message", props: { children: [{ type: "section" }] } }],
      },
    });
  });

  it("encodes update, delete, and stream", async () => {
    const { res, target, hold } = await openTurn();
    await adapter!.update({ id: "m1", threadId: "t1" }, renderToIR("Edited"));
    await adapter!.delete({ id: "m1", threadId: "t1" });
    const streamed = await adapter!.stream(target, chunks());
    hold.release();
    const events = await readEvents(res);

    expect(events.slice(1, -1)).toEqual([
      {
        type: EventType.CUSTOM,
        name: "channels.ui",
        value: {
          messageId: "m1",
          ir: [{ type: "text", props: { value: "Edited" } }],
        },
      },
      {
        type: EventType.CUSTOM,
        name: "channels.ui.delete",
        value: { messageId: "m1" },
      },
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId: streamed.id,
        role: "assistant",
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: streamed.id,
        delta: "Hel",
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: streamed.id,
        delta: "lo",
      },
      { type: EventType.TEXT_MESSAGE_END, messageId: streamed.id },
    ]);
  });

  it("closes spans the agent left open before RUN_FINISHED", async () => {
    const { res, target, hold } = await openTurn();
    const renderer = adapter!.createRunRenderer(target);
    const agent = { messages: [] } as never;
    await renderer.subscriber.onEvent?.({
      event: {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "x",
        role: "assistant",
      },
      agent,
    } as never);
    await renderer.markInterrupted();
    hold.release();
    const events = await readEvents(res);
    expect(events.map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
  });

  it("drops output for a conversation with no open request", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    adapter = web();
    await adapter.start(sink());
    const target: WebReplyTarget = {
      threadId: "gone",
      runId: "r",
      messages: [],
    };

    const ref = await adapter.post(target, renderToIR("hello"));
    await adapter.update(ref, renderToIR("bye"));

    expect(ref).toMatchObject({ threadId: "gone" });
    expect(debug).toHaveBeenCalledTimes(2);
  });

  it("stops writing when the client aborts", async () => {
    adapter = web();
    const hold = gate();
    const seen = gate();
    let target!: WebReplyTarget;
    await adapter.start(
      sink({
        onTurn: async (turn) => {
          target = turn.replyTarget as WebReplyTarget;
          seen.release();
          await hold.promise;
        },
      }),
    );
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const abort = new AbortController();
    const res = await adapter.handler(post(body(), { signal: abort.signal }));
    await seen.promise;
    abort.abort();
    await adapter.post(target, renderToIR("late"));
    hold.release();

    const events = await readEvents(res);
    expect(events.map((e) => e.type)).toEqual([EventType.RUN_STARTED]);
  });
});

describe("port option", () => {
  it("serves the handler from node:http on the configured path", async () => {
    adapter = web({ port: 0, host: "127.0.0.1", path: "/agent" });
    const turns: IncomingTurn[] = [];
    await adapter.start(sink({ onTurn: (t) => void turns.push(t) }));
    const base = `http://127.0.0.1:${adapter.port}`;

    const missing = await fetch(`${base}/other`, { method: "POST" });
    expect(missing.status).toBe(404);

    const res = await fetch(`${base}/agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body()),
    });
    expect(res.status).toBe(200);
    expect((await readEvents(res)).map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
    expect(turns).toHaveLength(1);
  });
});
