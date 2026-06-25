import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ActivityTypes } from "@microsoft/agents-activity";
import type { TurnContext } from "@microsoft/agents-hosting";
import { TeamsAdapter } from "./adapter.js";

/**
 * Regression coverage for the card-interaction auth fix.
 *
 * Adaptive Card `Action.Submit` clicks used to be handled on the inbound turn
 * context, whose connector client the M365 SDK builds with an anonymous
 * identity, so editing the card in place (`updateActivity`) was rejected 401
 * on real Teams. Credentialed interactions must instead run on the same
 * app-id-authenticated proactive (`continueConversation`) context as ordinary
 * replies. In the anonymous local Playground (no app id) the inbound context is
 * the only one available and is used directly.
 */
function cardClickContext(): TurnContext {
  const activity = {
    type: ActivityTypes.Message,
    value: { ckActionId: "ck:abc123", value: { confirmed: true } },
    conversation: { id: "conv-1" },
    from: { id: "user-1", name: "Tester" },
    replyToId: "card-activity-1",
    getConversationReference: () => ({
      conversation: { id: "conv-1" },
      serviceUrl: "https://smba.example/",
    }),
  };
  return { activity } as unknown as TurnContext;
}

function mockSink() {
  return {
    onTurn: vi.fn().mockResolvedValue(undefined),
    onCommand: vi.fn().mockResolvedValue(undefined),
    onInteraction: vi.fn().mockResolvedValue(undefined),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("TeamsAdapter card interactions", () => {
  let prevClientId: string | undefined;
  beforeEach(() => {
    prevClientId = process.env.clientId;
    delete process.env.clientId;
  });
  afterEach(() => {
    if (prevClientId !== undefined) process.env.clientId = prevClientId;
  });

  it("routes the interaction through the authenticated proactive context when credentialed", async () => {
    const adapter = new TeamsAdapter({ clientId: "app-123" });
    const proactiveCtx = { id: "proactive" } as unknown as TurnContext;
    const continueConversation = vi.fn(
      async (
        _appId: string,
        _ref: unknown,
        cb: (c: TurnContext) => unknown,
      ) => {
        await cb(proactiveCtx);
      },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adapter as any).cloud = { continueConversation };
    const sink = mockSink();
    const inbound = cardClickContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adapter as any).handleActivity(inbound, sink);
    await flush(); // the interaction runs on a detached proactive context

    expect(continueConversation).toHaveBeenCalledWith(
      "app-123",
      expect.anything(),
      expect.any(Function),
    );
    expect(sink.onInteraction).toHaveBeenCalledTimes(1);
    const evt = sink.onInteraction.mock.calls[0]![0];
    expect(evt.id).toBe("ck:abc123");
    expect(evt.value).toEqual({ confirmed: true });
    // The reply/edit context must be the proactive one, NOT the (anonymous)
    // inbound click context. That was the 401 bug.
    expect(evt.replyTarget.context).toBe(proactiveCtx);
    expect(evt.messageRef.context).toBe(proactiveCtx);
    expect(evt.messageRef.id).toBe("card-activity-1");
  });

  it("uses the inbound context for interactions in anonymous mode (no app id)", async () => {
    const adapter = new TeamsAdapter({});
    const continueConversation = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adapter as any).cloud = { continueConversation };
    const sink = mockSink();
    const inbound = cardClickContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adapter as any).handleActivity(inbound, sink);
    await flush();

    expect(continueConversation).not.toHaveBeenCalled();
    expect(sink.onInteraction).toHaveBeenCalledTimes(1);
    const evt = sink.onInteraction.mock.calls[0]![0];
    expect(evt.replyTarget.context).toBe(inbound);
    expect(evt.messageRef.context).toBe(inbound);
  });
});

/** A plain inbound message activity carrying optional file attachments. */
function messageContext(
  text: string,
  attachments?: Array<Record<string, unknown>>,
): TurnContext {
  const activity = {
    type: ActivityTypes.Message,
    text,
    attachments,
    conversation: { id: "conv-1" },
    from: { id: "user-1", name: "Sam" },
    removeRecipientMention: () => text,
    getConversationReference: () => ({
      conversation: { id: "conv-1" },
      serviceUrl: "https://smba.example/",
    }),
  };
  return { activity } as unknown as TurnContext;
}

describe("TeamsAdapter inbound files", () => {
  const prevClientId = process.env.clientId;
  beforeEach(() => delete process.env.clientId);
  afterEach(() => {
    if (prevClientId !== undefined) process.env.clientId = prevClientId;
  });

  it("delivers an uploaded CSV to the agent as a content part on the turn", async () => {
    const adapter = new TeamsAdapter({});
    const sink = mockSink();
    const csv = Buffer.from("month,sev1\nJan,3\nFeb,5\n").toString("base64");
    const ctx = messageContext("chart this", [
      {
        contentType: "text/csv",
        name: "incidents.csv",
        contentUrl: `data:text/csv;base64,${csv}`,
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adapter as any).handleActivity(ctx, sink);
    await flush();

    expect(sink.onTurn).toHaveBeenCalledTimes(1);
    const turn = sink.onTurn.mock.calls[0]![0];
    expect(turn.userText).toBe("chart this");
    expect(turn.contentParts).toBeDefined();
    // Leads with the user's text, then the decoded CSV as a text part.
    expect(turn.contentParts[0]).toEqual({ type: "text", text: "chart this" });
    const csvPart = turn.contentParts[1] as { type: string; text: string };
    expect(csvPart.type).toBe("text");
    expect(csvPart.text).toContain("month,sev1");
  });

  it("leaves contentParts undefined when there are no attachments", async () => {
    const adapter = new TeamsAdapter({});
    const sink = mockSink();
    const ctx = messageContext("hi");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adapter as any).handleActivity(ctx, sink);
    await flush();

    const turn = sink.onTurn.mock.calls[0]![0];
    expect(turn.contentParts).toBeUndefined();
  });
});

describe("TeamsAdapter.postFile", () => {
  it("sends a PNG as an inline image attachment via a data: URI", async () => {
    const adapter = new TeamsAdapter({});
    const sendActivity = vi.fn().mockResolvedValue({ id: "msg-9" });
    const target = {
      conversationKey: "conv-1",
      reference: {},
      context: { sendActivity } as unknown as TurnContext,
    };

    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const res = await adapter.postFile(target, {
      bytes,
      filename: "chart.png",
      title: "Chart",
      altText: "Sev counts",
    });

    expect(res).toEqual({ ok: true, fileId: "msg-9" });
    const sent = sendActivity.mock.calls[0]![0];
    const attachment = sent.attachments[0];
    expect(attachment.contentType).toBe("image/png");
    expect(attachment.contentUrl).toBe(
      `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
    );
    expect(attachment.name).toBe("Sev counts");
  });

  it("returns an error result when there is no context to send on", async () => {
    const adapter = new TeamsAdapter({});
    const res = await adapter.postFile(
      { conversationKey: "conv-1", reference: {} },
      { bytes: new Uint8Array([1]), filename: "x.png" },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
  });
});

describe("TeamsAdapter typing heartbeat", () => {
  it("sends typing immediately, repeats on a timer, and stops when cleared", () => {
    vi.useFakeTimers();
    try {
      const adapter = new TeamsAdapter({});
      const sendActivity = vi.fn().mockResolvedValue({ id: "t" });
      const target = {
        conversationKey: "c",
        reference: {},
        context: { sendActivity } as unknown as TurnContext,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stop = (adapter as any).startTypingHeartbeat(target) as () => void;
      expect(sendActivity).toHaveBeenCalledTimes(1); // immediate

      vi.advanceTimersByTime(3500 * 2);
      expect(sendActivity).toHaveBeenCalledTimes(3); // two more ticks

      stop();
      vi.advanceTimersByTime(3500 * 3);
      expect(sendActivity).toHaveBeenCalledTimes(3); // none after stop

      // It sends a typing activity, not text.
      expect(sendActivity.mock.calls[0]![0].type).toBe("typing");
    } finally {
      vi.useRealTimers();
    }
  });
});
