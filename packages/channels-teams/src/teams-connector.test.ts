import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ActivityTypes } from "@microsoft/agents-activity";
import type { TurnContext } from "@microsoft/agents-hosting";
import { CloudAdapterTeamsConnector } from "./teams-connector.js";
import type { TeamsIngressConfig } from "./teams-connector.js";

/**
 * Regression coverage for the card-interaction auth fix, now exercised
 * against the connector (ingress ownership moved here — plan §2 D3/Task 3b).
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

function mockConfig(sink: ReturnType<typeof mockSink>) {
  const recordUser = vi.fn();
  const config: TeamsIngressConfig = {
    sink: sink as unknown as TeamsIngressConfig["sink"],
    recordUser,
  };
  return { config, recordUser };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("CloudAdapterTeamsConnector card interactions", () => {
  it("routes the interaction through the authenticated proactive context when credentialed", async () => {
    const connector = new CloudAdapterTeamsConnector({ clientId: "app-123" });
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
    (connector as any).cloud = { continueConversation };
    const sink = mockSink();
    const { config } = mockConfig(sink);
    const inbound = cardClickContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (connector as any).handleActivity(inbound, config);
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
    const connector = new CloudAdapterTeamsConnector({});
    const continueConversation = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (connector as any).cloud = { continueConversation };
    const sink = mockSink();
    const { config } = mockConfig(sink);
    const inbound = cardClickContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (connector as any).handleActivity(inbound, config);
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

describe("CloudAdapterTeamsConnector inbound files", () => {
  it("delivers an uploaded CSV to the sink as a content part on the turn", async () => {
    const connector = new CloudAdapterTeamsConnector({});
    const sink = mockSink();
    const { config, recordUser } = mockConfig(sink);
    const csv = Buffer.from("month,sev1\nJan,3\nFeb,5\n").toString("base64");
    const ctx = messageContext("chart this", [
      {
        contentType: "text/csv",
        name: "incidents.csv",
        contentUrl: `data:text/csv;base64,${csv}`,
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (connector as any).handleActivity(ctx, config);
    await flush();

    expect(sink.onTurn).toHaveBeenCalledTimes(1);
    const turn = sink.onTurn.mock.calls[0]![0];
    expect(turn.userText).toBe("chart this");
    expect(turn.contentParts).toBeDefined();
    expect(turn.contentParts[0]).toEqual({ type: "text", text: "chart this" });
    const csvPart = turn.contentParts[1] as { type: string; text: string };
    expect(csvPart.type).toBe("text");
    expect(csvPart.text).toContain("month,sev1");
    // The transcript-persistence DECISION stays adapter-side (a callback).
    expect(recordUser).toHaveBeenCalledWith("conv-1", turn.contentParts);
  });

  it("leaves contentParts undefined when there are no attachments, and carries §2 signals", async () => {
    const connector = new CloudAdapterTeamsConnector({});
    const sink = mockSink();
    const { config } = mockConfig(sink);
    const ctx = messageContext("hi");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (connector as any).handleActivity(ctx, config);
    await flush();

    const turn = sink.onTurn.mock.calls[0]![0];
    expect(turn.contentParts).toBeUndefined();
    // No conversationType on the fake activity → treated as a personal chat.
    expect(turn.conversationKind).toBe("direct_message");
    expect(turn.mentioned).toBe(false);
  });
});

describe("CloudAdapterTeamsConnector.sendFile", () => {
  it("sends a PNG as an inline image attachment via a data: URI", async () => {
    const connector = new CloudAdapterTeamsConnector({});
    const sendActivity = vi.fn().mockResolvedValue({ id: "msg-9" });
    const target = {
      reference: {},
      context: { sendActivity } as unknown as TurnContext,
    };

    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const id = await connector.sendFile(target, {
      contentType: "image/png",
      contentUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
      name: "Sev counts",
    });

    expect(id).toBe("msg-9");
    const sent = sendActivity.mock.calls[0]![0];
    const attachment = sent.attachments[0];
    expect(attachment.contentType).toBe("image/png");
    expect(attachment.name).toBe("Sev counts");
  });

  it("throws when there is no live or proactive context to post on", async () => {
    const connector = new CloudAdapterTeamsConnector({});
    await expect(
      connector.sendFile(
        { reference: undefined },
        { contentType: "image/png", contentUrl: "data:x", name: "x.png" },
      ),
    ).rejects.toThrow("no live or proactive context to post on");
  });
});

describe("CloudAdapterTeamsConnector typing heartbeat", () => {
  let prevSetInterval: unknown;
  beforeEach(() => {
    prevSetInterval = global.setInterval;
  });
  afterEach(() => {
    global.setInterval = prevSetInterval as typeof global.setInterval;
  });

  it("sends typing immediately, repeats on a timer, and stops when cleared", () => {
    vi.useFakeTimers();
    try {
      const connector = new CloudAdapterTeamsConnector({});
      const sendActivity = vi.fn().mockResolvedValue({ id: "t" });
      const target = {
        reference: {},
        context: { sendActivity } as unknown as TurnContext,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stop = (connector as any).startTypingHeartbeat(
        target,
      ) as () => void;
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
