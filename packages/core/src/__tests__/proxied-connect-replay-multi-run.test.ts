import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AGUIConnectNotImplementedError, EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { EMPTY, Subject } from "rxjs";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import { CopilotKitCore } from "../core";

/**
 * Issue #4943 (part 2): hydrating an existing thread through `/connect` on a
 * self-hosted runtime.
 *
 * A `/connect` response replays the thread's history, so it can legitimately
 * carry events from several past runs — including a run that ended in
 * RUN_ERROR followed by a later RUN_STARTED. AbstractAgent's connect pipeline
 * runs the stream through `verifyEvents`, which enforces single-run lifecycle
 * rules and rejects a RUN_STARTED after a RUN_ERROR:
 *
 *   Cannot send event type 'RUN_STARTED': The run has already errored with
 *   'RUN_ERROR'. No further events can be sent.
 *
 * IntelligenceAgent already omits `verifyEvents` from its connect pipeline for
 * exactly this reason (see intelligence-agent.ts). Self-hosted runtimes
 * (RUNTIME_MODE_SSE) still inherit the base pipeline, so replay of a thread
 * whose history contains an errored run fails to hydrate.
 */

const encoder = new TextEncoder();

function createEventResponse(events: BaseEvent[]) {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

const approvalHistory = [
  {
    type: EventType.RUN_STARTED,
    threadId: "existing-thread",
    runId: "approval",
  },
  { type: EventType.STATE_SNAPSHOT, snapshot: { approval: "pending" } },
  {
    type: EventType.TEXT_MESSAGE_START,
    messageId: "approval-message",
    role: "assistant",
  },
  {
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId: "approval-message",
    delta: "Approve?",
  },
  { type: EventType.TEXT_MESSAGE_END, messageId: "approval-message" },
  {
    type: EventType.RUN_FINISHED,
    threadId: "existing-thread",
    runId: "approval",
    outcome: {
      type: "interrupt",
      interrupts: [{ id: "approval-one", reason: "confirmation" }],
    },
  },
];

function createReplayAgent(transport: "rest" | "single" | "auto" = "rest") {
  return new ProxiedCopilotRuntimeAgent({
    runtimeUrl: "https://runtime.example/hono",
    agentId: "hydrating-agent",
    threadId: "existing-thread",
    transport,
    ...(transport === "auto" ? { runtimeMode: "pending" as const } : {}),
  });
}

function requestBody(init?: RequestInit) {
  return typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
}

function createConnectReplayResponse(): Response {
  const stream = new ReadableStream({
    start(controller) {
      const events = [
        // ---- first past run: ended in RUN_ERROR ----
        { type: "RUN_STARTED", threadId: "existing-thread", runId: "run-1" },
        {
          type: "TEXT_MESSAGE_START",
          messageId: "msg-1",
          role: "assistant",
        },
        {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "msg-1",
          delta: "first run answer",
        },
        { type: "TEXT_MESSAGE_END", messageId: "msg-1" },
        {
          type: "RUN_ERROR",
          threadId: "existing-thread",
          runId: "run-1",
          message: "upstream model error",
        },
        // ---- second past run: replayed in the same /connect stream ----
        { type: "RUN_STARTED", threadId: "existing-thread", runId: "run-2" },
        {
          type: "TEXT_MESSAGE_START",
          messageId: "msg-2",
          role: "assistant",
        },
        {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "msg-2",
          delta: "second run answer",
        },
        { type: "TEXT_MESSAGE_END", messageId: "msg-2" },
        {
          type: "RUN_FINISHED",
          threadId: "existing-thread",
          runId: "run-2",
          result: { newMessages: [] },
        },
      ];
      controller.enqueue(
        encoder.encode(
          events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
        ),
      );
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("self-hosted /connect replay across multiple past runs (#4943)", () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(createConnectReplayResponse()),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it("hydrates a thread whose replayed history contains an errored run", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example/hono",
      agentId: "hydrating-agent",
      transport: "rest",
    });
    agent.threadId = "existing-thread";

    await expect(agent.connectAgent()).resolves.toBeDefined();

    expect(agent.messages.map((m) => m.id)).toEqual(["msg-1", "msg-2"]);
  });

  it("rebuilds repeated full replay without duplicating past runs", async () => {
    const agent = createReplayAgent();
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "hydrating-agent", agent });
    await core.connectAgent({ agent });
    await core.connectAgent({ agent });
    expect(agent.messages.map((message) => message.content)).toEqual([
      "first run answer",
      "second run answer",
    ]);
  });

  it.each(["rest", "single", "auto"] as const)(
    "restores a pending approval on repeated %s connects without a decision",
    async (transport) => {
      fetchMock.mockImplementation((url, init) => {
        const body = requestBody(init);
        if (!body || body.method === "info") {
          return Promise.resolve(Response.json({ mode: "sse", agents: {} }));
        }
        if (String(url).endsWith("/run") || body.method === "agent/run") {
          const input = body.body ?? body;
          return Promise.resolve(
            createEventResponse([
              {
                type: EventType.RUN_STARTED,
                threadId: input.threadId,
                runId: input.runId,
              },
              {
                type: EventType.TEXT_MESSAGE_CHUNK,
                messageId: "answer",
                role: "assistant",
                delta: "Approved.",
              },
              {
                type: EventType.RUN_FINISHED,
                threadId: input.threadId,
                runId: input.runId,
                outcome: { type: "success" },
              },
            ]),
          );
        }
        return Promise.resolve(createEventResponse(approvalHistory));
      });
      const agent = createReplayAgent(transport);
      const core = new CopilotKitCore({});
      core.addAgent__unsafe_dev_only({ id: "hydrating-agent", agent });
      for (let connection = 0; connection < 2; connection++) {
        await core.connectAgent({ agent });
        expect(
          agent.pendingInterrupts.map((interrupt) => interrupt.id),
        ).toEqual(["approval-one"]);
        expect(agent.messages.map((message) => message.content)).toEqual([
          "Approve?",
        ]);
        expect(agent.state).toEqual({ approval: "pending" });
      }
      const connects = fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/connect") ||
          requestBody(init)?.method === "agent/connect",
      );
      expect(connects).toHaveLength(2);
      expect(
        connects.map(([, init]) => {
          const body = requestBody(init);
          return (body.body ?? body).resume;
        }),
      ).toEqual([undefined, undefined]);
      await expect(agent.runAgent()).rejects.toThrow(/resume/i);
      expect(fetchMock.mock.calls).toHaveLength(transport === "auto" ? 3 : 2);
      await core.runAgent({
        agent,
        runId: "approved-new",
        resume: [
          { interruptId: "approval-one", status: "resolved", payload: true },
        ],
      });
      expect(agent.pendingInterrupts).toEqual([]);
      expect(agent.messages.map((message) => message.content)).toEqual([
        "Approve?",
        "Approved.",
      ]);
      const submitted = requestBody(fetchMock.mock.calls.at(-1)?.[1]);
      expect(submitted.body ?? submitted).toMatchObject({
        runId: "approved-new",
        resume: [
          { interruptId: "approval-one", status: "resolved", payload: true },
        ],
      });
    },
  );

  it.each(["http", "discovery", "abort"] as const)(
    "keeps the prior view when %s fails before replay",
    async (failure) => {
      const agent = createReplayAgent(
        failure === "discovery" ? "auto" : "rest",
      );
      agent.setMessages([
        { id: "saved", role: "assistant", content: "Saved answer" },
      ]);
      agent.setState({ saved: true });
      fetchMock.mockImplementation(() =>
        failure === "abort"
          ? Promise.reject(new DOMException("Aborted", "AbortError"))
          : Promise.resolve(new Response("Unavailable", { status: 503 })),
      );
      if (failure !== "abort") {
        await expect(agent.connectAgent()).rejects.toThrow();
      } else {
        await expect(agent.connectAgent()).resolves.toBeDefined();
      }
      expect(agent.messages).toEqual([
        { id: "saved", role: "assistant", content: "Saved answer" },
      ]);
      expect(agent.state).toEqual({ saved: true });
    },
  );

  it("clears a stale view after a successful empty replay", async () => {
    const agent = createReplayAgent();
    agent.setMessages([
      { id: "stale", role: "assistant", content: "Old answer" },
    ]);
    agent.setState({ stale: true });
    fetchMock.mockImplementation(() =>
      Promise.resolve(createEventResponse([])),
    );
    await agent.connectAgent();
    expect(agent.messages).toEqual([]);
    expect(agent.state).toEqual({});
  });

  it("does not start an abandoned connect after initialization completes", async () => {
    const agent = createReplayAgent();
    let releaseInitialization = () => {};
    const initialized = new Promise<void>((resolve) => {
      releaseInitialization = resolve;
    });
    const onRunInitialized = vi.fn(async () => {
      await initialized;
      return {
        messages: [
          { id: "abandoned", role: "assistant" as const, content: "Stale" },
        ],
        state: { abandoned: true },
      };
    });
    const abandoned = agent.connectAgent({}, { onRunInitialized });
    await vi.waitFor(() => expect(onRunInitialized).toHaveBeenCalledOnce());
    const detached = agent.detachActiveRun();
    const successor = agent.connectAgent();
    releaseInitialization();
    await Promise.all([abandoned, detached, successor]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(agent.messages.map((message) => message.content)).toEqual([
      "first run answer",
      "second run answer",
    ]);
    expect(agent.isRunning).toBe(false);
    expect(agent.state).toEqual({});
  });

  it("does not reopen an abandoned selection after discovery completes", async () => {
    let releaseInfo = (_response: Response) => {};
    const info = new Promise<Response>((resolve) => {
      releaseInfo = resolve;
    });
    fetchMock.mockImplementationOnce(() => info);
    const agent = createReplayAgent("auto");
    const abandoned = agent.connectAgent();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await agent.detachActiveRun();
    agent.threadId = "fresh-thread";
    agent.threadId = "existing-thread";
    const successor = agent.connectAgent();
    releaseInfo(Response.json({ mode: "sse", agents: {} }));
    await Promise.all([abandoned, successor]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(agent.messages.map((message) => message.content)).toEqual([
      "first run answer",
      "second run answer",
    ]);
  });

  it("does not start an abandoned Core connect after a subscriber finishes", async () => {
    const core = new CopilotKitCore({});
    const agent = createReplayAgent();
    core.addAgent__unsafe_dev_only({ id: "hydrating-agent", agent });
    let releaseStarted = () => {};
    const started = new Promise<void>((resolve) => {
      releaseStarted = resolve;
    });
    const onAgentRunStarted = vi.fn().mockImplementationOnce(() => started);
    core.subscribe({ onAgentRunStarted });
    const abandoned = core.connectAgent({ agent });
    await vi.waitFor(() => expect(onAgentRunStarted).toHaveBeenCalledOnce());
    await core.connectAgent({ agent });
    releaseStarted();
    await abandoned;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(agent.messages.map((message) => message.content)).toEqual([
      "first run answer",
      "second run answer",
    ]);
  });

  it("detaches the old SSE replay when the runtime switches to Intelligence", async () => {
    const agent = createReplayAgent();
    const events = new Subject<BaseEvent>();
    const connect = vi.spyOn(agent, "connect").mockReturnValue(events);
    const replay = agent.connectAgent();
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
    agent.adoptRuntimeMode("intelligence", {
      wsUrl: "ws://localhost:4401/client",
    });
    events.next({
      type: EventType.STATE_SNAPSHOT,
      snapshot: { obsolete: true },
    });
    expect(agent.state).toEqual({});
    expect(events.observed).toBe(false);
    await replay;
  });

  it("does not let an old discovery response replace an adopted runtime mode", async () => {
    let releaseInfo = (_response: Response) => {};
    const info = new Promise<Response>((resolve) => {
      releaseInfo = resolve;
    });
    fetchMock.mockImplementationOnce(() => info);
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example/hono",
      agentId: "hydrating-agent",
      transport: "rest",
      runtimeMode: "pending",
    });
    agent.threadId = "existing-thread";
    const abandoned = agent.connectAgent();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    agent.adoptRuntimeMode("sse", undefined);
    releaseInfo(
      Response.json({
        mode: "intelligence",
        intelligence: { wsUrl: "ws://localhost:4401/client" },
      }),
    );
    await abandoned;
    await agent.connectAgent();
    expect(agent.messages.map((message) => message.content)).toEqual([
      "first run answer",
      "second run answer",
    ]);
  });

  it("keeps approvals with their thread across A to B to A", async () => {
    fetchMock.mockImplementation((url, init) => {
      const input = requestBody(init);
      if (input.threadId === "existing-thread") {
        return Promise.resolve(createEventResponse(approvalHistory));
      }
      if (String(url).endsWith("/connect")) {
        return Promise.resolve(createEventResponse([]));
      }
      return Promise.resolve(
        createEventResponse([
          {
            type: EventType.RUN_STARTED,
            threadId: input.threadId,
            runId: input.runId,
          },
          {
            type: EventType.TEXT_MESSAGE_CHUNK,
            messageId: "thread-b-answer",
            role: "assistant",
            delta: "Thread B",
          },
          {
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
            outcome: { type: "success" },
          },
        ]),
      );
    });
    const core = new CopilotKitCore({});
    const agent = createReplayAgent();
    core.addAgent__unsafe_dev_only({ id: "hydrating-agent", agent });
    await core.connectAgent({ agent });
    expect(agent.pendingInterrupts.map((interrupt) => interrupt.id)).toEqual([
      "approval-one",
    ]);
    agent.threadId = "thread-b";
    await core.connectAgent({ agent });
    expect(agent.pendingInterrupts).toEqual([]);
    await core.runAgent({ agent, runId: "thread-b-run" });
    expect(agent.messages.map((message) => message.content)).toEqual([
      "Thread B",
    ]);
    agent.threadId = "existing-thread";
    await core.connectAgent({ agent });
    expect(agent.pendingInterrupts.map((interrupt) => interrupt.id)).toEqual([
      "approval-one",
    ]);
    expect(agent.messages.map((message) => message.content)).toEqual([
      "Approve?",
    ]);
  });

  it("preserves a fresh thread's live approval on its first connect", async () => {
    const core = new CopilotKitCore({});
    const agent = createReplayAgent();
    core.addAgent__unsafe_dev_only({ id: "hydrating-agent", agent });
    await core.connectAgent({ agent });
    agent.threadId = "thread-b";
    agent.setMessages([]);
    agent.setState({});
    fetchMock.mockImplementation((url, init) => {
      if (String(url).endsWith("/connect"))
        return Promise.resolve(createEventResponse([]));
      const input = requestBody(init);
      return Promise.resolve(
        createEventResponse([
          {
            type: EventType.RUN_STARTED,
            threadId: input.threadId,
            runId: input.runId,
          },
          {
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
            outcome: {
              type: "interrupt",
              interrupts: [{ id: "approval-b", reason: "approval" }],
            },
          },
        ]),
      );
    });
    await core.runAgent({ agent });
    expect(agent.pendingInterrupts.map((interrupt) => interrupt.id)).toEqual([
      "approval-b",
    ]);
    await core.connectAgent({ agent });
    expect(agent.pendingInterrupts.map((interrupt) => interrupt.id)).toEqual([
      "approval-b",
    ]);
    await expect(agent.runAgent()).rejects.toThrow(/resume/i);
  });

  it.each([true, false])(
    "replaces a fresh thread baseline when returning to saved history (empty: %s)",
    async (emptyHistory) => {
      const core = new CopilotKitCore({});
      const agent = createReplayAgent();
      core.addAgent__unsafe_dev_only({ id: "hydrating-agent", agent });
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          createEventResponse(emptyHistory ? [] : approvalHistory),
        ),
      );
      await core.connectAgent({ agent });
      agent.threadId = "thread-b";
      agent.setMessages([]);
      agent.setState({});
      agent.pendingInterrupts = [];
      fetchMock.mockImplementation((_url, init) => {
        const input = requestBody(init);
        return Promise.resolve(
          createEventResponse([
            {
              type: EventType.RUN_STARTED,
              threadId: input.threadId,
              runId: input.runId,
            },
            {
              type: EventType.TEXT_MESSAGE_CHUNK,
              messageId: "b-message",
              role: "assistant",
              delta: "Thread B",
            },
            { type: EventType.STATE_SNAPSHOT, snapshot: { thread: "b" } },
            {
              type: EventType.RUN_FINISHED,
              threadId: input.threadId,
              runId: input.runId,
              outcome: {
                type: "interrupt",
                interrupts: [{ id: "approval-b", reason: "approval" }],
              },
            },
          ]),
        );
      });
      await core.runAgent({ agent });
      expect(agent.pendingInterrupts.map((interrupt) => interrupt.id)).toEqual([
        "approval-b",
      ]);
      agent.threadId = "existing-thread";
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          createEventResponse(emptyHistory ? [] : approvalHistory),
        ),
      );
      await core.connectAgent({ agent });
      expect(agent.pendingInterrupts.map((interrupt) => interrupt.id)).toEqual(
        emptyHistory ? [] : ["approval-one"],
      );
      expect(agent.messages.map((message) => message.content)).toEqual(
        emptyHistory ? [] : ["Approve?"],
      );
      expect(agent.state).toEqual(emptyHistory ? {} : { approval: "pending" });
    },
  );

  it("keeps a successor's detach signal when finalization starts another connect", async () => {
    const agent = createReplayAgent();
    const currentEvents = new Subject<BaseEvent>();
    const connect = vi
      .spyOn(agent, "connect")
      .mockReturnValueOnce(EMPTY)
      .mockReturnValue(currentEvents);
    let successor: ReturnType<typeof agent.connectAgent> | undefined;
    await agent.connectAgent(
      {},
      {
        onRunFinalized: () => {
          successor = agent.connectAgent();
        },
      },
    );
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
    expect(agent.isRunning).toBe(true);
    await agent.detachActiveRun();
    await successor;
    expect(agent.isRunning).toBe(false);
    expect(currentEvents.observed).toBe(false);
  });

  it("translates 0.x shapes in replayed history, like the base connect pipeline", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const legacyEvents = [
      { type: "RUN_STARTED", threadId: "existing-thread", runId: "run-0" },
      {
        type: "MESSAGES_SNAPSHOT",
        messages: [
          {
            id: "user-0",
            role: "user",
            content: [{ type: "binary", mimeType: "image/png", data: "aGk=" }],
          },
        ],
      },
      { type: "THINKING_START" },
      { type: "THINKING_TEXT_MESSAGE_START" },
      { type: "THINKING_TEXT_MESSAGE_CONTENT", delta: "pondering" },
      { type: "THINKING_TEXT_MESSAGE_END" },
      { type: "THINKING_END" },
      { type: "RUN_FINISHED", threadId: "existing-thread", runId: "run-0" },
    ];
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          legacyEvents.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
      ),
    );
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example/hono",
      agentId: "legacy-history-agent",
      transport: "rest",
    });
    agent.threadId = "existing-thread";

    await agent.connectAgent();

    expect(agent.messages[0]).toMatchObject({
      id: "user-0",
      content: [
        {
          type: "image",
          source: { type: "data", value: "aGk=", mimeType: "image/png" },
        },
      ],
    });
    expect(agent.messages[1]).toMatchObject({
      role: "reasoning",
      content: "pondering",
    });
  });

  /**
   * The verifyEvents-free pipeline must keep the base implementation's special
   * case for agents that don't implement `connect()`: swallow the error rather
   * than route it through `onError`.
   *
   * `CopilotKitCore` awaits `detachActiveRun()` before every run and only
   * resolves because this path reaches the pipeline's finalize block (see the
   * historical deadlock note in run-handler.ts). Surfacing it through onError
   * would also fire run-failure callbacks on every subscriber for a benign
   * condition.
   */
  it("swallows AGUIConnectNotImplementedError instead of failing the run", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example/hono",
      agentId: "no-connect-agent",
      transport: "rest",
    });

    // Stand in for an agent whose transport has no /connect implementation.
    vi.spyOn(agent, "connect").mockImplementation(() => {
      throw new AGUIConnectNotImplementedError();
    });

    const onRunFailed = vi.fn();
    const onRunErrorEvent = vi.fn();
    agent.subscribe({ onRunFailed, onRunErrorEvent });

    await expect(agent.connectAgent()).resolves.toBeDefined();

    expect(onRunFailed).not.toHaveBeenCalled();
    expect(onRunErrorEvent).not.toHaveBeenCalled();
    // The finalize block must still have run, or detachActiveRun() would hang.
    expect(agent.isRunning).toBe(false);
    await expect(agent.detachActiveRun()).resolves.toBeUndefined();
  });
});

describe.each(["rest", "single"] as const)(
  "%s HTTP connection completion",
  (transport) => {
    afterEach(() => vi.unstubAllGlobals());
    it("applies history after an old error and releases isRunning when the response closes", async () => {
      const stream = new TransformStream<Uint8Array, Uint8Array>();
      const writer = stream.writable.getWriter();
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(stream.readable, {
              headers: { "Content-Type": "text/event-stream" },
            }),
        ),
      );
      const agent = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: "http://localhost/runtime",
        runtimeMode: "sse",
        transport,
        agentId: "chat",
      });
      const errors = vi.fn();
      agent.subscribe({ onRunErrorEvent: errors });
      const connecting = agent.connectAgent();
      const send = (event: BaseEvent) =>
        writer.write(
          new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      try {
        await send({
          type: EventType.RUN_ERROR,
          message: "Historical failure",
        });
        await vi.waitFor(() => expect(errors).toHaveBeenCalledOnce());
        expect(agent.isRunning).toBe(true);
        await send({
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [
            { id: "later", role: "assistant", content: "Later history" },
          ],
        });
        await send({ type: EventType.RUN_ERROR, message: "Live failure" });
        await writer.close();
        await connecting;
        expect(agent.isRunning).toBe(false);
        expect(errors).toHaveBeenCalledTimes(2);
        expect(agent.messages[0]?.content).toBe("Later history");
      } finally {
        await agent.detachActiveRun();
      }
    });
  },
);
