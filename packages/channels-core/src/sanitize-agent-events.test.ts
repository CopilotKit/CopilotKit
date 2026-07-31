import { describe, it, expect } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { sanitizeAgentEventStream } from "./sanitize-agent-events.js";
import { createChannel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const encoder = new TextEncoder();

/** Serialize an AG-UI event as one SSE frame. */
const frame = (event: unknown): string => `data: ${JSON.stringify(event)}\n\n`;

/** A Response whose body streams `chunks` verbatim, one enqueue per chunk. */
function streamResponse(
  chunks: string[],
  contentType = "text/event-stream",
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(encoder.encode(chunk));
      c.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

/**
 * A run whose `TOOL_CALL_START` carries `parentMessageId: null` — the shape
 * `@ag-ui/langgraph` emits for the tool call that triggers an interrupt, and
 * the one `EventSchemas.parse` rejects with "Expected string, received null".
 */
const nullParentRun = (): string[] => [
  frame({ type: "RUN_STARTED", threadId: "t1", runId: "r1" }),
  frame({
    type: "TOOL_CALL_START",
    toolCallId: "tc1",
    toolCallName: "ask_human",
    parentMessageId: null,
  }),
  frame({ type: "TOOL_CALL_ARGS", toolCallId: "tc1", delta: "{}" }),
  frame({ type: "TOOL_CALL_END", toolCallId: "tc1" }),
  frame({ type: "RUN_FINISHED", threadId: "t1", runId: "r1" }),
];

/** An `HttpAgent` whose transport replays `chunks` instead of hitting a server. */
function agentServing(chunks: string[], contentType?: string): HttpAgent {
  return new HttpAgent({
    url: "http://agent.test/run",
    fetch: (async () => streamResponse(chunks, contentType)) as typeof fetch,
  });
}

/** Read a wrapped transport's response body back as text. */
async function bodyText(agent: HttpAgent): Promise<string> {
  const res = await agent.fetch("http://agent.test/run", {});
  return await res.text();
}

describe("sanitizeAgentEventStream", () => {
  it("lets a run carrying a null parentMessageId reach RUN_FINISHED", async () => {
    const agent = sanitizeAgentEventStream(agentServing(nullParentRun()));

    const started: string[] = [];
    await agent.runAgent(
      {},
      {
        onToolCallStartEvent: ({ event }) =>
          void started.push(event.toolCallName),
      },
    );

    expect(started).toEqual(["ask_human"]);
  });

  it("aborts that same run when the sanitizer is not applied", async () => {
    const agent = agentServing(nullParentRun());

    await expect(agent.runAgent({})).rejects.toThrow(
      /parentMessageId|received null/,
    );
  });

  it("coerces the null to an empty string and leaves every other byte alone", async () => {
    const agent = sanitizeAgentEventStream(
      agentServing([
        ": keep-alive\n\n",
        frame({
          type: "TOOL_CALL_START",
          toolCallId: "tc1",
          toolCallName: "ask_human",
          parentMessageId: null,
        }),
        frame({
          type: "TOOL_CALL_START",
          toolCallId: "tc2",
          toolCallName: "other",
          parentMessageId: "msg-1",
        }),
      ]),
    );

    expect(await bodyText(agent)).toBe(
      ": keep-alive\n\n" +
        `data: {"type":"TOOL_CALL_START","toolCallId":"tc1","toolCallName":"ask_human","parentMessageId":""}\n\n` +
        `data: {"type":"TOOL_CALL_START","toolCallId":"tc2","toolCallName":"other","parentMessageId":"msg-1"}\n\n`,
    );
  });

  it("coerces a null split across two transport chunks", async () => {
    const whole = frame({
      type: "TOOL_CALL_START",
      toolCallId: "tc1",
      toolCallName: "ask_human",
      parentMessageId: null,
    });
    const split = whole.indexOf("null") + 2;
    const agent = sanitizeAgentEventStream(
      agentServing([whole.slice(0, split), whole.slice(split)]),
    );

    expect(await bodyText(agent)).toContain(`"parentMessageId":""`);
  });

  it("still converts a mid-stream abort into RUN_ERROR rather than failing the run", async () => {
    // The stock transform turns an AbortError into a synthetic RUN_ERROR and
    // completes the stream. Replacing the transform (as SanitizingHttpAgent
    // does) forfeits that; wrapping the transport must not.
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(
          encoder.encode(
            frame({ type: "RUN_STARTED", threadId: "t1", runId: "r1" }),
          ),
        );
        c.error(abort);
      },
    });
    const agent = sanitizeAgentEventStream(
      new HttpAgent({
        url: "http://agent.test/run",
        fetch: (async () =>
          new Response(body, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })) as typeof fetch,
      }),
    );

    const errors: string[] = [];
    await agent.runAgent(
      {},
      { onRunErrorEvent: ({ event }) => void errors.push(event.code ?? "") },
    );

    expect(errors).toEqual(["abort"]);
  });

  it("passes a non-SSE body through untouched so protobuf still negotiates", async () => {
    const proto = '\u0000\u0001"parentMessageId":null';
    const agent = sanitizeAgentEventStream(
      agentServing([proto], "application/vnd.ag-ui+proto"),
    );

    expect(await bodyText(agent)).toBe(proto);
  });

  it("does not re-wrap a transport it has already wrapped", () => {
    const agent = sanitizeAgentEventStream(agentServing(nullParentRun()));
    const wrapped = agent.fetch;

    sanitizeAgentEventStream(agent);

    expect(agent.fetch).toBe(wrapped);
  });

  it("leaves an agent that has no HTTP transport alone", () => {
    const agent = new FakeAgent();

    expect(sanitizeAgentEventStream(agent)).toBe(agent);
    expect("fetch" in agent).toBe(false);
  });
});

describe("createChannel({ sanitizeAgentEvents })", () => {
  /** Run one turn through a channel backed by `agent`; resolve the run's error, if any. */
  async function runTurn(
    agent: HttpAgent,
    opts?: { sanitizeAgentEvents?: boolean },
  ): Promise<unknown> {
    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      agent: () => agent,
      ...opts,
    });

    let failure: unknown;
    channel.onMention(async ({ thread }) => {
      try {
        await thread.runAgent();
      } catch (err) {
        failure = err;
      }
    });

    await channel.ɵruntime.start();
    fake.emitTurn({ userText: "yo", conversationKey: "c1" });
    await tick();
    await tick();
    return failure;
  }

  it("sanitizes a null parentMessageId by default", async () => {
    expect(await runTurn(agentServing(nullParentRun()))).toBeUndefined();
  });

  it("survives the per-run clone of a singleton agent", async () => {
    // A singleton `agent` is cloned per turn (isolateAgentInstance). HttpAgent's
    // clone() copies the transport but not own-property overrides of run(), so
    // sanitizing has to live on the transport to reach the cloned instance.
    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      agent: agentServing(nullParentRun()),
    });

    let failure: unknown;
    channel.onMention(async ({ thread }) => {
      try {
        await thread.runAgent();
      } catch (err) {
        failure = err;
      }
    });

    await channel.ɵruntime.start();
    fake.emitTurn({ userText: "yo", conversationKey: "c1" });
    await tick();
    await tick();

    expect(failure).toBeUndefined();
  });

  it("lets the run abort when sanitizing is disabled", async () => {
    const failure = await runTurn(agentServing(nullParentRun()), {
      sanitizeAgentEvents: false,
    });

    expect(String(failure)).toMatch(/parentMessageId|received null/);
  });
});
