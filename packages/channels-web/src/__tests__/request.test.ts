import { describe, expect, it } from "vitest";
import {
  actorFor,
  buildInteraction,
  buildTurn,
  parseRunRequest,
} from "../request.js";

function input(overrides: Record<string, unknown> = {}) {
  return {
    threadId: "t1",
    runId: "r1",
    messages: [
      { id: "u1", role: "user", content: "first" },
      { id: "a1", role: "assistant", content: "reply" },
      { id: "u2", role: "user", content: "second" },
    ],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
    ...overrides,
  };
}

describe("parseRunRequest", () => {
  it("rejects a body that is not a RunAgentInput", () => {
    expect(parseRunRequest({ threadId: "t1" })).toEqual({
      ok: false,
      error: "body is not a valid AG-UI RunAgentInput",
    });
  });

  it("classifies a plain request as a turn for the newest user message", () => {
    const result = parseRunRequest(input());
    expect(result.ok && result.request.kind).toBe("turn");
    if (result.ok && result.request.kind === "turn") {
      expect(result.request.message.id).toBe("u2");
    }
  });

  it("uses the newest user message even when an assistant message follows it", () => {
    const body = input({
      messages: [
        { id: "u1", role: "user", content: "only" },
        { id: "a1", role: "assistant", content: "reply" },
      ],
    });
    const result = parseRunRequest(body);
    expect(
      result.ok && result.request.kind === "turn" && result.request.message.id,
    ).toBe("u1");
  });

  it("rejects a turn with no user message", () => {
    expect(parseRunRequest(input({ messages: [] }))).toEqual({
      ok: false,
      error: "messages has no user message to answer",
    });
  });

  it("classifies forwardedProps.channelInteraction as a click", () => {
    const result = parseRunRequest(
      input({
        forwardedProps: {
          channelInteraction: { id: "ck:abc", value: "yes", messageId: "m1" },
        },
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      request: {
        kind: "interaction",
        interaction: { id: "ck:abc", value: "yes", messageId: "m1" },
      },
    });
  });

  it.each([
    [{ value: 1 }],
    [{ id: "" }],
    [{ id: "ck:a", messageId: 3 }],
    [{ id: "ck:a", values: ["x"] }],
    ["ck:a"],
  ])("rejects a malformed channelInteraction %j", (channelInteraction) => {
    const result = parseRunRequest(
      input({ forwardedProps: { channelInteraction } }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("ingress events", () => {
  it("builds a mentioned, created turn keyed by threadId", () => {
    const result = parseRunRequest(input());
    if (!result.ok || result.request.kind !== "turn") throw new Error("setup");
    const turn = buildTurn(result.request, actorFor(undefined, "t1"));

    expect(turn).toMatchObject({
      conversationKey: "t1",
      userText: "second",
      platform: "web",
      operation: {
        kind: "created",
        logicalMessageId: "u2",
        revisionId: "r1",
        mentioned: true,
      },
      actor: { id: "anonymous:t1", kind: "unknown" },
      replyTarget: { threadId: "t1", runId: "r1" },
    });
    expect(turn.identityContext.conversation).toEqual({
      id: "t1",
      kind: "direct",
    });
  });

  it("reads text from multimodal user content", () => {
    const result = parseRunRequest(
      input({
        messages: [
          {
            id: "u1",
            role: "user",
            content: [
              { type: "text", text: "look at " },
              { type: "text", text: "this" },
            ],
          },
        ],
      }),
    );
    if (!result.ok || result.request.kind !== "turn") throw new Error("setup");
    expect(buildTurn(result.request, actorFor(undefined, "t1")).userText).toBe(
      "look at this",
    );
  });

  it("builds an interaction with the raw select value and a message ref", () => {
    const result = parseRunRequest(
      input({
        forwardedProps: {
          channelInteraction: {
            id: "ck:sel",
            value: ["a", "b"],
            values: { note: "hi" },
            messageId: "m1",
          },
        },
      }),
    );
    if (!result.ok || result.request.kind !== "interaction") {
      throw new Error("setup");
    }
    const evt = buildInteraction(
      result.request,
      actorFor({ id: "user-7", name: "Ada" }, "t1"),
    );
    expect(evt).toMatchObject({
      id: "ck:sel",
      value: ["a", "b"],
      rawValue: ["a", "b"],
      values: { note: "hi" },
      conversationKey: "t1",
      eventId: "r1",
      messageRef: { id: "m1", threadId: "t1" },
      actor: { id: "user-7", kind: "human", name: "Ada" },
    });
  });

  it("omits rawValue for a non-string value", () => {
    const result = parseRunRequest(
      input({
        forwardedProps: { channelInteraction: { id: "ck:b", value: { n: 1 } } },
      }),
    );
    if (!result.ok || result.request.kind !== "interaction") {
      throw new Error("setup");
    }
    const evt = buildInteraction(result.request, actorFor(undefined, "t1"));
    expect(evt.value).toEqual({ n: 1 });
    expect(evt).not.toHaveProperty("rawValue");
    expect(evt).not.toHaveProperty("messageRef");
  });
});
