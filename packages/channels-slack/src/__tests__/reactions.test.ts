import { describe, it, expect, vi } from "vitest";
import { decodeReaction } from "../interaction.js";
import type { ReplyTarget } from "../types.js";

describe("decodeReaction", () => {
  it("maps a reaction_added event to an IncomingReaction", () => {
    const evt = decodeReaction(
      {
        user: "U1",
        reaction: "thumbsup",
        item: { type: "message", channel: "C9", ts: "171.1" },
      },
      true,
    );
    expect(evt).toMatchObject({
      rawEmoji: "thumbsup",
      added: true,
      user: { id: "U1" },
      messageId: "171.1",
      replyTarget: { channel: "C9" },
    });
    expect(evt!.conversationKey).toBe("C9::171.1");
  });

  it("uses DM_SCOPE for direct-message channels", () => {
    const evt = decodeReaction(
      {
        user: "U1",
        reaction: "x",
        item: { type: "message", channel: "D2", ts: "9.9" },
      },
      false,
    );
    expect(evt!.added).toBe(false);
    expect(evt!.conversationKey).toBe("D2::dm");
  });

  it("threads the reply target under the reacted message in a channel", () => {
    const evt = decodeReaction(
      {
        user: "U1",
        reaction: "thumbsup",
        item: { type: "message", channel: "C9", ts: "171.1" },
      },
      true,
    );
    expect((evt!.replyTarget as ReplyTarget).threadTs).toBe("171.1");
  });

  it("carries the reactor id as recipientUserId on a channel reply target", () => {
    // chat.startStream requires recipient_user_id when streaming to a channel.
    // The reaction reply target must carry it (parity with onTurn) so a native
    // channel stream started from a reaction does not fail and process-wide
    // downgrade nativeStreamingOk.
    const evt = decodeReaction(
      {
        user: "U1",
        reaction: "thumbsup",
        item: { type: "message", channel: "C9", ts: "171.1" },
      },
      true,
    );
    expect((evt!.replyTarget as ReplyTarget).recipientUserId).toBe("U1");
  });

  it("keeps the reply target flat (no threadTs) for a DM reaction", () => {
    const evt = decodeReaction(
      {
        user: "U1",
        reaction: "x",
        item: { type: "message", channel: "D2", ts: "9.9" },
      },
      false,
    );
    expect((evt!.replyTarget as ReplyTarget).threadTs).toBeUndefined();
  });

  it("ignores non-message reaction items", () => {
    expect(
      decodeReaction(
        { user: "U1", reaction: "x", item: { type: "file", file: "F1" } },
        true,
      ),
    ).toBeUndefined();
  });
});

const BOT_USER_ID = "UBOT0001";

/**
 * A permissive fake Bolt `App` that records the `reaction_added`/
 * `reaction_removed` handlers registered during `startIngress()` and no-ops
 * every other registration (message/event/action/view/command/assistant) the
 * connector and its sub-listeners attach. Mocked at the `@slack/bolt` module
 * level (not via a field swap on the adapter) — `App` construction now lives
 * inside `WebClientSlackConnector.startIngress` (Task 3b), not on the adapter.
 */
const reactionHandlers: Record<string, (args: { event: unknown }) => unknown> =
  {};

vi.mock("@slack/bolt", () => ({
  App: class {
    init = vi.fn().mockResolvedValue(undefined);
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    event(name: string, handler: (args: { event: unknown }) => unknown) {
      reactionHandlers[name] = handler;
    }
    message() {}
    action() {}
    view() {}
    command() {}
    assistant() {}
    use() {}
  },
  LogLevel: { ERROR: "error", WARN: "warn", INFO: "info", DEBUG: "debug" },
}));

function fireReaction(name: string, event: unknown) {
  return reactionHandlers[name]?.({ event });
}

function makeSink() {
  return {
    onTurn: vi.fn().mockResolvedValue(undefined),
    onCommand: vi.fn().mockResolvedValue(undefined),
    onInteraction: vi.fn().mockResolvedValue(undefined),
    onReaction: vi.fn().mockResolvedValue(undefined),
    onModalSubmit: vi.fn().mockResolvedValue(undefined),
    onModalClose: vi.fn().mockResolvedValue(undefined),
  };
}

describe("adapter reaction ingress loop guard", () => {
  async function startWithFakes() {
    const { SlackAdapter } = await import("../adapter.js");
    const { WebClientSlackConnector } = await import("../slack-connector.js");
    // Disable the assistant middleware so start() takes the simplest listener path.
    const adapter = new SlackAdapter({ assistant: false });
    // A REAL WebClientSlackConnector (the credential-owning connector a
    // runner would construct) — its internal `client` is patched so
    // `startIngress`'s `auth.test()`/reaction-user enrichment resolve without
    // a live Slack API, while the mocked `@slack/bolt` `App` above still
    // drives the real ingress wiring (attachSlackListener, loop guard, etc.).
    const connector = new WebClientSlackConnector({
      botToken: "xoxb",
      appToken: "xapp",
      signingSecret: "s",
    });
    const usersInfo = vi.fn().mockResolvedValue({
      user: {
        id: "UHUMAN",
        name: "humanuser",
        real_name: "Human User",
        profile: { email: "human@example.com" },
      },
    });
    (connector as unknown as { client: unknown }).client = {
      auth: {
        test: vi
          .fn()
          .mockResolvedValue({ user_id: BOT_USER_ID, team_id: "T1" }),
      },
      users: { info: usersInfo },
    };
    adapter.ɵbindConnector(connector);
    const sink = makeSink();
    await adapter.start(sink as never);
    return { sink, usersInfo };
  }

  it("does NOT dispatch the bot's OWN reaction to sink.onReaction", async () => {
    const { sink } = await startWithFakes();
    await fireReaction("reaction_added", {
      user: BOT_USER_ID,
      reaction: "thumbsup",
      item: { type: "message", channel: "C9", ts: "171.1" },
    });
    expect(sink.onReaction).not.toHaveBeenCalled();
  });

  it("DOES dispatch a normal user's reaction to sink.onReaction", async () => {
    const { sink } = await startWithFakes();
    await fireReaction("reaction_added", {
      user: "UHUMAN",
      reaction: "thumbsup",
      item: { type: "message", channel: "C9", ts: "171.1" },
    });
    expect(sink.onReaction).toHaveBeenCalledTimes(1);
  });

  it("enriches the reaction user via resolveUser (name + email), not a bare {id}", async () => {
    const { sink, usersInfo } = await startWithFakes();
    await fireReaction("reaction_added", {
      user: "UHUMAN",
      reaction: "thumbsup",
      item: { type: "message", channel: "C9", ts: "171.1" },
    });
    expect(usersInfo).toHaveBeenCalledWith({ user: "UHUMAN" });
    const evt = sink.onReaction.mock.calls[0]?.[0] as {
      user?: { id: string; name?: string; email?: string };
    };
    expect(evt.user).toEqual({
      id: "UHUMAN",
      name: "Human User",
      email: "human@example.com",
    });
  });

  it("enriches the reaction user on reaction_removed too", async () => {
    const { sink } = await startWithFakes();
    await fireReaction("reaction_removed", {
      user: "UHUMAN",
      reaction: "thumbsup",
      item: { type: "message", channel: "C9", ts: "171.1" },
    });
    const evt = sink.onReaction.mock.calls[0]?.[0] as {
      user?: { id: string; name?: string; email?: string };
    };
    expect(evt.user).toMatchObject({ name: "Human User" });
  });
});

describe("adapter reaction egress", () => {
  it("calls reactions.add with the resolved Slack shortcode", async () => {
    const { SlackAdapter } = await import("../adapter.js");
    const { FakeSlackConnector } =
      await import("../testing/fake-slack-connector.js");
    const adapter = new SlackAdapter({});
    const connector = new FakeSlackConnector();
    adapter.ɵbindConnector(connector);
    const res = await adapter.addReaction!(
      { channel: "C1" },
      { id: "1.2", channel: "C1" },
      "thumbs_up",
    );
    expect(res).toEqual({ ok: true });
    expect(connector.calls[0]!.op).toBe("addReaction");
    expect(connector.calls[0]!.args).toEqual({
      channel: "C1",
      timestamp: "1.2",
      name: "+1",
    });
  });
});
