import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@ag-ui/client";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import { CopilotKitCore } from "../core";
import { ɵrepairToolCallPairs } from "../core/message-filter";
import {
  waitForCondition,
  createAssistantMessage,
  createMultipleToolCallsMessage,
  createMessage,
  createToolCallMessage,
  createToolResultMessage,
} from "./test-utils";

const encoder = new TextEncoder();

function createSseResponse(): Response {
  const events = [
    { type: "RUN_STARTED", threadId: "test-thread", runId: "test-run" },
    {
      type: "RUN_FINISHED",
      threadId: "test-thread",
      runId: "test-run",
      result: { newMessages: [] },
    },
  ];
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
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

function infoResponse(): Response {
  return new Response(
    JSON.stringify({
      version: "1.0.0",
      agents: {
        default: {
          name: "default",
          className: "HttpAgent",
          description: "assistant",
        },
      },
      audioFileTranscriptionEnabled: false,
      mode: "sse",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function toolCallIdsOf(message: Message): string[] {
  const calls = (message as { toolCalls?: { id: string }[] }).toolCalls ?? [];
  return calls.map((call) => call.id);
}

function toolCallIdOf(message: Message): string {
  const calls = (message as { toolCalls?: { id: string }[] }).toolCalls;
  if (!calls?.[0]) throw new Error("message carries no tool call");
  return calls[0].id;
}

/** The messages that actually went on the wire for a REST run request. */
function sentMessages(init: RequestInit): Message[] {
  return JSON.parse(init.body as string).messages;
}

describe("ɵrepairToolCallPairs", () => {
  it("restores the assistant call in front of a kept tool result", () => {
    const call = createToolCallMessage("lookup");
    const result = createToolResultMessage(toolCallIdOf(call), "done");
    const full = [createMessage({ id: "u1" }), call, result];

    const repaired = ɵrepairToolCallPairs([result], full);

    // Dropping the result would be valid but would throw away the only new
    // information in a human-in-the-loop turn.
    expect(repaired.map((m) => m.id)).toEqual([call.id, result.id]);
  });

  it("restores every sibling result when it restores a parallel call", () => {
    const call = createMultipleToolCallsMessage([
      { name: "lookupA" },
      { name: "lookupB" },
    ]);
    const [callA, callB] = toolCallIdsOf(call);
    const resultA = createToolResultMessage(callA!, "a");
    const resultB = createToolResultMessage(callB!, "b");
    const full = [call, resultA, resultB];

    // Keeping only the second result: a provider rejects the turn unless the
    // first call is answered too.
    const repaired = ɵrepairToolCallPairs([resultB], full);

    expect(repaired.map((m) => m.id)).toEqual([
      call.id,
      resultA.id,
      resultB.id,
    ]);
  });

  it("restores the result of a kept call, directly after the call", () => {
    const call = createToolCallMessage("lookup");
    const result = createToolResultMessage(toolCallIdOf(call), "done");
    const followUp = createAssistantMessage({ id: "a2" });
    const full = [createMessage({ id: "u1" }), call, result, followUp];

    const repaired = ɵrepairToolCallPairs([call, followUp], full);

    expect(repaired.map((m) => m.id)).toEqual([call.id, result.id, "a2"]);
  });

  it("leaves an open call alone when no result exists yet", () => {
    // Mid-HITL: the call is awaiting a human, so the pair is not broken.
    const call = createToolCallMessage("askUser");
    const full = [createMessage({ id: "u1" }), call];

    const repaired = ɵrepairToolCallPairs([call], full);

    expect(repaired.map((m) => m.id)).toEqual([call.id]);
  });

  it("keeps a tool result whose issuing call is not in this thread", () => {
    // No issuer to reason about, so dropping it would be the client inventing
    // a rule the backend never stated.
    const orphan = createToolResultMessage("call-from-elsewhere", "done");
    const full = [createMessage({ id: "u1" }), orphan];

    const repaired = ɵrepairToolCallPairs([orphan], full);

    expect(repaired.map((m) => m.id)).toEqual([orphan.id]);
  });

  it("preserves the filter's order and never duplicates a message", () => {
    const call = createToolCallMessage("lookup");
    const result = createToolResultMessage(toolCallIdOf(call), "done");
    const full = [call, result];

    const repaired = ɵrepairToolCallPairs([call, result], full);

    expect(repaired.map((m) => m.id)).toEqual([call.id, result.id]);
  });

  it("returns the list untouched when the filter kept everything", () => {
    const full = [
      createMessage({ id: "u1" }),
      createAssistantMessage({ id: "a1" }),
    ];

    expect(ɵrepairToolCallPairs(full, full)).toEqual(full);
  });
});

describe("ProxiedCopilotRuntimeAgent messageFilter", () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(createSseResponse());
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  const history = (): Message[] => [
    createMessage({ id: "u1", content: "first" }),
    createAssistantMessage({ id: "a1" }),
    createMessage({ id: "u2", content: "latest" }),
  ];

  it("sends the whole thread when no filter is set", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
    });
    agent.setMessages(history());

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
  });

  it("sends only what the filter kept", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => messages.slice(-1),
    });
    agent.setMessages(history());

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u2"]);
  });

  it("leaves the rendered transcript at full length", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => messages.slice(-1),
    });
    agent.setMessages(history());

    await agent.runAgent();

    expect(agent.messages.map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
  });

  it("repairs the tool-call pair a blunt filter would have split", async () => {
    // The #1482 failure in reverse: trimming to the last message on a thread
    // that ends in a tool result leaves the provider a result with no call.
    const call = createToolCallMessage("lookup");
    const result = createToolResultMessage(toolCallIdOf(call), "done");
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => messages.slice(-1),
    });
    agent.setMessages([createMessage({ id: "u1" }), call, result]);

    await agent.runAgent();

    // The call comes back, the earlier user turn stays trimmed. Sending `[]`
    // here would hand a resuming backend nothing to act on.
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual([call.id, result.id]);
  });

  it("restores a dropped result so a kept call is never left unanswered", async () => {
    const call = createToolCallMessage("lookup");
    const result = createToolResultMessage(toolCallIdOf(call), "done");
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => messages.filter((m) => m.role !== "tool"),
    });
    agent.setMessages([createMessage({ id: "u1" }), call, result]);

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual([
      "u1",
      call.id,
      result.id,
    ]);
  });

  it("hands the filtered list to run(), whichever transport it dispatches to", async () => {
    // `run()` is the fork between the HTTP transports and the Intelligence
    // delegate, and the delegate forwards this input rather than rebuilding
    // one. Asserting here covers the delegate path without standing up a
    // gateway.
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => messages.slice(-1),
    });
    agent.setMessages(history());
    const run = vi.spyOn(agent, "run");

    await agent.runAgent();

    const input = run.mock.calls[0]?.[0];
    expect(input?.messages.map((m) => m.id)).toEqual(["u2"]);
  });

  it("tells the filter which agent is running", async () => {
    const seen: string[] = [];
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "billing-agent",
      transport: "rest",
      messageFilter: (messages, context) => {
        seen.push(context.agentId);
        return messages;
      },
    });
    agent.setMessages(history());

    await agent.runAgent();

    expect(seen).toEqual(["billing-agent"]);
  });

  it("hides activity messages from the filter", async () => {
    const seen: Message[][] = [];
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => {
        seen.push(messages);
        return messages;
      },
    });
    agent.setMessages([
      createMessage({ id: "u1" }),
      createMessage({ id: "act1", role: "activity" } as never),
      createMessage({ id: "u2" }),
    ]);

    await agent.runAgent();

    expect(seen[0]?.map((m) => m.id)).toEqual(["u1", "u2"]);
  });

  it("cannot corrupt the transcript by mutating the array it is handed", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => {
        messages.length = 0;
        (messages as { push: (m: Message) => void }).push(
          createMessage({ id: "injected" }),
        );
        return messages;
      },
    });
    agent.setMessages(history());

    await agent.runAgent();

    expect(agent.messages.map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
  });

  it("falls back to the full thread when the filter returns a non-array", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (() => undefined) as never,
    });
    agent.setMessages(history());

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("messageFilter returned a non-array value"),
    );
  });

  it("falls back to the full thread when the filter throws", async () => {
    // Trimming is an optimization. A bug in it must not take the user's
    // message down with it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: () => {
        throw new Error("boom");
      },
    });
    agent.setMessages(history());

    await expect(agent.runAgent()).resolves.toMatchObject({
      newMessages: expect.any(Array),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("messageFilter threw"),
      expect.any(Error),
    );
  });

  it("applies a filter assigned after construction", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
    });
    agent.setMessages(history());
    agent.messageFilter = (messages) => messages.slice(-1);

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u2"]);
  });

  it("survives clone(), which the runtime does once per run", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => messages.slice(-1),
    });
    agent.setMessages(history());

    const cloned = agent.clone();
    await cloned.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u2"]);
  });

  it("trims the payload on the single-route transport too", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "single",
      messageFilter: (messages) => messages.slice(-1),
    });
    agent.setMessages(history());

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const envelope = JSON.parse(init.body as string);
    expect(envelope.body.messages.map((m: Message) => m.id)).toEqual(["u2"]);
  });
});

describe("CopilotKitCore messageFilter reaches runtime-discovered agents", () => {
  const originalFetch = global.fetch;
  const originalWindow = (global as { window?: unknown }).window;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("/info") ? infoResponse() : createSseResponse(),
        ),
      );
    global.fetch = fetchMock as unknown as typeof fetch;
    // The core only opens its `/info` connection in a browser.
    (global as { window?: unknown }).window = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (global as { window?: unknown }).window;
    } else {
      (global as { window?: unknown }).window = originalWindow;
    }
  });

  const runRequestBody = (): Message[] => {
    // `endsWith`, not `includes`: the `/info` URL contains "/runtime.example".
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/run"),
    ) as [string, RequestInit];
    return sentMessages(call[1]);
  };

  it("trims the payload of an agent the runtime advertised", async () => {
    // The case #1482 reporters actually have: no agent instance of their own,
    // just `<CopilotKit runtimeUrl>` and an agent discovered from `/info`.
    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      messageFilter: (messages) => messages.slice(-1),
    });
    await waitForCondition(() => Boolean(core.getAgent("default")));

    const agent = core.getAgent("default")!;
    agent.setMessages([
      createMessage({ id: "u1" }),
      createAssistantMessage({ id: "a1" }),
      createMessage({ id: "u2" }),
    ]);
    await agent.runAgent();

    expect(runRequestBody().map((m) => m.id)).toEqual(["u2"]);
  });

  it("applies a filter set after the agent was discovered", async () => {
    const core = new CopilotKitCore({ runtimeUrl: "https://runtime.example" });
    await waitForCondition(() => Boolean(core.getAgent("default")));

    core.setMessageFilter((messages) => messages.slice(-1));

    const agent = core.getAgent("default")!;
    agent.setMessages([
      createMessage({ id: "u1" }),
      createMessage({ id: "u2" }),
    ]);
    await agent.runAgent();

    expect(runRequestBody().map((m) => m.id)).toEqual(["u2"]);
  });

  it("goes back to the full thread when the filter is cleared", async () => {
    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      messageFilter: (messages) => messages.slice(-1),
    });
    await waitForCondition(() => Boolean(core.getAgent("default")));

    core.setMessageFilter(undefined);

    const agent = core.getAgent("default")!;
    agent.setMessages([
      createMessage({ id: "u1" }),
      createMessage({ id: "u2" }),
    ]);
    await agent.runAgent();

    expect(runRequestBody().map((m) => m.id)).toEqual(["u1", "u2"]);
  });
});
