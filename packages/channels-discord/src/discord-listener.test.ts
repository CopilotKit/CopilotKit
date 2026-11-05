import { describe, it, expect, vi } from "vitest";
import { attachDiscordListener } from "./discord-listener.js";
import { PendingInteractions } from "./pending-interactions.js";

function fakeClient() {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  return {
    on(event: string, cb: (...args: unknown[]) => void) {
      handlers[event] = cb;
    },
    emit(event: string, ...args: unknown[]) {
      handlers[event]?.(...args);
    },
  };
}

/** A complete (non-partial) reaction with the fields decodeReaction needs. */
function reaction(over: Record<string, unknown> = {}) {
  return {
    partial: false,
    emoji: { name: "👍", id: null },
    message: { id: "m1", channelId: "c1", guildId: "g1", partial: false },
    ...over,
  };
}

/**
 * Let the listener's async work settle. Resolving the reply target is async
 * now, because a threaded mention has to open the thread before the turn is
 * dispatched.
 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const botId = "bot-1";

function message(over: Record<string, unknown>) {
  return {
    id: "m1",
    author: { id: "u1", bot: false, username: "ann", globalName: "Ann" },
    content: "hello",
    channelId: "c1",
    guildId: "g1",
    mentions: { has: () => false, users: { has: () => false } },
    channel: { isDMBased: () => false },
    ...over,
  };
}

describe("attachDiscordListener", () => {
  it("emits a turn when the bot is mentioned", async () => {
    const client = fakeClient();
    const onTurn = vi.fn();
    attachDiscordListener({
      client: client as any,
      botUserId: botId,
      onTurn,
      onCommand: vi.fn(),
    });
    client.emit(
      "messageCreate",
      message({
        mentions: {
          has: () => true,
          users: { has: (q: string) => q === "bot-1" },
        },
        content: "<@bot-1> hi",
      }),
    );
    await flush();
    expect(onTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: "c1",
        messageId: "m1",
        mentioned: true,
        replyTarget: { channelId: "c1", guildId: "g1" },
        actor: {
          id: "u1",
          kind: "human",
          name: "Ann",
          handle: "ann",
        },
      }),
    );
  });

  /** A mention that can open a thread, recording the create call. */
  function mentionMsg(over: Record<string, unknown> = {}) {
    const started: Array<{ name: string; autoArchiveDuration?: number }> = [];
    const msg = message({
      mentions: {
        has: () => true,
        users: { has: (q: string) => q === "bot-1" },
      },
      content: "<@bot-1> why is checkout slow",
      startThread: async (o: {
        name: string;
        autoArchiveDuration?: number;
      }) => {
        started.push(o);
        return { id: "t1" };
      },
      ...over,
    });
    return { msg, started };
  }

  function listen(over: Record<string, unknown> = {}) {
    const client = fakeClient();
    const onTurn = vi.fn();
    attachDiscordListener({
      client: client as any,
      botUserId: botId,
      onTurn,
      onCommand: vi.fn(),
      ...over,
    });
    return { client, onTurn };
  }

  it("opens a thread on a mention by default and answers inside it", async () => {
    const { client, onTurn } = listen();
    const { msg, started } = mentionMsg();

    client.emit("messageCreate", msg);
    await flush();

    // The thread is named from the user's text, with the mention stripped.
    expect(started).toEqual([
      { name: "why is checkout slow", autoArchiveDuration: 1440 },
    ]);
    // The reply goes to the thread, and the thread is its own conversation.
    expect(onTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: "t1",
        replyTarget: { channelId: "t1", guildId: "g1" },
      }),
    );
  });

  it('replies in the channel when reply is "channel"', async () => {
    const { client, onTurn } = listen({
      respondTo: { appMentions: { reply: "channel" } },
    });
    const { msg, started } = mentionMsg();

    client.emit("messageCreate", msg);
    await flush();

    expect(started).toEqual([]);
    expect(onTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: "c1",
        replyTarget: { channelId: "c1", guildId: "g1" },
      }),
    );
  });

  it("does not open a thread inside a thread, or in a DM", async () => {
    const inThread = listen();
    const a = mentionMsg({
      channel: { isDMBased: () => false, isThread: () => true },
    });
    inThread.client.emit("messageCreate", a.msg);

    const dm = listen();
    const b = mentionMsg({
      channel: { isDMBased: () => true },
      guildId: null,
    });
    dm.client.emit("messageCreate", b.msg);
    await flush();

    // Nesting is impossible on Discord, and a DM has no threads at all.
    expect(a.started).toEqual([]);
    expect(b.started).toEqual([]);
    expect(inThread.onTurn).toHaveBeenCalledWith(
      expect.objectContaining({ conversationKey: "c1" }),
    );
    expect(dm.onTurn).toHaveBeenCalledTimes(1);
  });

  it("still answers in the channel when opening a thread fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, onTurn } = listen();
    const { msg } = mentionMsg({
      // What a missing CREATE_PUBLIC_THREADS permission looks like.
      startThread: async () => {
        throw new Error("Missing Permissions");
      },
    });

    client.emit("messageCreate", msg);
    await flush();

    // Losing the thread must never cost the user their turn.
    expect(onTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: "c1",
        replyTarget: { channelId: "c1", guildId: "g1" },
      }),
    );
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("names a thread even when the mention carries no text, and caps at 100", async () => {
    const empty = listen();
    const a = mentionMsg({ content: "<@bot-1>" });
    empty.client.emit("messageCreate", a.msg);

    const long = listen();
    const b = mentionMsg({ content: `<@bot-1> ${"x".repeat(200)}` });
    long.client.emit("messageCreate", b.msg);
    await flush();

    expect(a.started[0]?.name).toBe("New conversation");
    expect(b.started[0]?.name).toHaveLength(100);
  });

  it("does not answer a role / @everyone mention that only matches via mentions.has", () => {
    const client = fakeClient();
    const onTurn = vi.fn();
    attachDiscordListener({
      client: client as any,
      botUserId: botId,
      onTurn,
      onCommand: vi.fn(),
    });
    // `mentions.has` is true (e.g. a role mention the bot belongs to), but the
    // bot is not a direct user mention, so we must NOT answer.
    client.emit(
      "messageCreate",
      message({
        mentions: { has: () => true, users: { has: () => false } },
        content: "<@&role-1> ping everyone",
      }),
    );
    expect(onTurn).not.toHaveBeenCalled();
  });

  it("emits a turn for a DM even without a mention", async () => {
    const client = fakeClient();
    const onTurn = vi.fn();
    attachDiscordListener({
      client: client as any,
      botUserId: botId,
      onTurn,
      onCommand: vi.fn(),
    });
    client.emit(
      "messageCreate",
      message({ channel: { isDMBased: () => true }, guildId: null }),
    );
    await flush();
    expect(onTurn).toHaveBeenCalledTimes(1);
  });

  it("ignores the bot's own messages", () => {
    const client = fakeClient();
    const onTurn = vi.fn();
    attachDiscordListener({
      client: client as any,
      botUserId: botId,
      onTurn,
      onCommand: vi.fn(),
    });
    client.emit(
      "messageCreate",
      message({ author: { id: "bot-1", bot: true } }),
    );
    expect(onTurn).not.toHaveBeenCalled();
  });

  it("ignores other bots", () => {
    const client = fakeClient();
    const onTurn = vi.fn();
    attachDiscordListener({
      client: client as any,
      botUserId: botId,
      onTurn,
      onCommand: vi.fn(),
    });
    client.emit("messageCreate", message({ author: { id: "u2", bot: true } }));
    expect(onTurn).not.toHaveBeenCalled();
  });

  it("resolves a getter-form botUserId per event", async () => {
    const client = fakeClient();
    const onTurn = vi.fn();
    let id = "";
    attachDiscordListener({
      client: client as any,
      botUserId: () => id,
      onTurn,
      onCommand: vi.fn(),
    });
    // Before the id is known, the bot's own message would not match a mention,
    // but a DM still answers regardless of id.
    id = "bot-1";
    client.emit(
      "messageCreate",
      message({
        mentions: {
          has: (q: string) => q === "bot-1",
          users: { has: (q: string) => q === "bot-1" },
        },
        content: "<@bot-1> hi",
      }),
    );
    await flush();
    expect(onTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: "c1",
        actor: expect.objectContaining({ id: "u1", kind: "human" }),
      }),
    );
  });

  it("forwards a chat-input command via onCommand with a triggerId, then settles (deferReply) when no modal opens", async () => {
    const client = fakeClient();
    const onCommand = vi.fn();
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const commandPending = new PendingInteractions({
      ackBufferMs: 2500,
      defer: (i) =>
        (i as unknown as { deferReply: typeof deferReply }).deferReply(),
    });
    attachDiscordListener({
      client: client as any,
      botUserId: botId,
      onTurn: vi.fn(),
      onCommand,
      commandPending,
    });
    client.emit("interactionCreate", {
      isChatInputCommand: () => true,
      id: "int-1",
      commandName: "triage",
      channelId: "c1",
      guildId: "g1",
      user: { id: "u1", username: "ann", globalName: "Ann" },
      options: { data: [{ name: "priority", value: "high" }] },
      deferReply,
    });
    // Let the async command handler (dispatch + settle) run to completion.
    await Promise.resolve();
    await Promise.resolve();
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "triage",
        conversationKey: "c1",
        rawOptions: { priority: "high" },
        triggerId: "int-1",
      }),
    );
    // No handler opened a modal, so `settle` acks via deferReply (the eager
    // `i.reply(...)` is gone — the registry now owns the ack).
    expect(deferReply).toHaveBeenCalledTimes(1);
  });

  it("clears the dangling deferred ephemeral after a non-modal command settles", async () => {
    const client = fakeClient();
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const deleteReply = vi.fn().mockResolvedValue(undefined);
    const commandPending = new PendingInteractions({
      ackBufferMs: 2500,
      // The settle ack defers the reply, marking the interaction `deferred`.
      defer: async (i) => {
        await (i as unknown as { deferReply: typeof deferReply }).deferReply();
        (i as unknown as { deferred: boolean }).deferred = true;
      },
    });
    attachDiscordListener({
      client: client as any,
      botUserId: botId,
      onTurn: vi.fn(),
      // No modal opened → the auto-defer ack leaves a dangling ephemeral
      // "thinking…" spinner that must be cleared.
      onCommand: vi.fn(),
      commandPending,
    });
    const interaction = {
      isChatInputCommand: () => true,
      id: "int-3",
      commandName: "triage",
      channelId: "c1",
      guildId: "g1",
      user: { id: "u1" },
      options: { data: [] },
      deferred: false,
      replied: false,
      deferReply,
      deleteReply,
    };
    client.emit("interactionCreate", interaction);
    await new Promise((r) => setTimeout(r, 0));
    expect(deferReply).toHaveBeenCalledTimes(1);
    expect(deleteReply).toHaveBeenCalledTimes(1);
  });

  it("does not delete the reply when a command opened a modal (no defer)", async () => {
    const client = fakeClient();
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const deleteReply = vi.fn().mockResolvedValue(undefined);
    const commandPending = new PendingInteractions({
      ackBufferMs: 2500,
      defer: (i) =>
        (i as unknown as { deferReply: typeof deferReply }).deferReply(),
    });
    attachDiscordListener({
      client: client as any,
      botUserId: botId,
      onTurn: vi.fn(),
      // Simulate a handler that opened a modal: it marks the live interaction
      // responded so `settle` never defers, and `deferred` stays false.
      onCommand: async (cmd) => {
        await commandPending.respondWith(cmd.triggerId!, async () => {});
      },
      commandPending,
    });
    const interaction = {
      isChatInputCommand: () => true,
      id: "int-4",
      commandName: "open-modal",
      channelId: "c1",
      guildId: "g1",
      user: { id: "u1" },
      options: { data: [] },
      deferred: false,
      replied: false,
      deferReply,
      deleteReply,
    };
    client.emit("interactionCreate", interaction);
    await new Promise((r) => setTimeout(r, 0));
    expect(deferReply).not.toHaveBeenCalled();
    expect(deleteReply).not.toHaveBeenCalled();
  });

  it("does not ack or dispatch a non-command interaction", async () => {
    const client = fakeClient();
    const onCommand = vi.fn();
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const commandPending = new PendingInteractions({
      ackBufferMs: 2500,
      defer: (i) =>
        (i as unknown as { deferReply: typeof deferReply }).deferReply(),
    });
    attachDiscordListener({
      client: client as any,
      botUserId: botId,
      onTurn: vi.fn(),
      onCommand,
      commandPending,
    });
    client.emit("interactionCreate", {
      isChatInputCommand: () => false,
      id: "int-2",
      commandName: "triage",
      channelId: "c1",
      guildId: "g1",
      user: { id: "u1" },
      options: { data: [] },
      deferReply,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(deferReply).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("catches a rejecting onTurn handler instead of letting it escape", async () => {
    const client = fakeClient();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onTurn = vi.fn().mockRejectedValue(new Error("boom"));
    attachDiscordListener({
      client: client as any,
      botUserId: botId,
      onTurn,
      onCommand: vi.fn(),
    });
    expect(() =>
      client.emit(
        "messageCreate",
        message({
          mentions: {
            has: () => true,
            users: { has: (q: string) => q === "bot-1" },
          },
          content: "<@bot-1> hi",
        }),
      ),
    ).not.toThrow();
    // Let the rejected promise settle so the .catch runs.
    await flush();
    expect(errSpy).toHaveBeenCalledWith(
      "[bot-discord] onTurn handler failed:",
      expect.any(Error),
    );
    errSpy.mockRestore();
  });

  it("catches a rejecting onReaction handler instead of letting it escape", async () => {
    const client = fakeClient();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onReaction = vi.fn().mockRejectedValue(new Error("boom"));
    attachDiscordListener({
      client: client as any,
      botUserId: botId,
      onTurn: vi.fn(),
      onCommand: vi.fn(),
      onReaction,
    });
    expect(() =>
      client.emit("messageReactionAdd", reaction(), { id: "u1", bot: false }),
    ).not.toThrow();
    // Let the rejected promise settle so the .catch runs.
    await Promise.resolve();
    await Promise.resolve();
    expect(onReaction).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith(
      "[bot-discord] onReaction handler failed:",
      expect.any(Error),
    );
    errSpy.mockRestore();
  });

  it("skips the bot's own reaction by id even when the bot flag is undefined (partial user)", () => {
    const client = fakeClient();
    const onReaction = vi.fn();
    attachDiscordListener({
      client: client as any,
      botUserId: botId,
      onTurn: vi.fn(),
      onCommand: vi.fn(),
      onReaction,
    });
    // A PARTIAL user has no `bot` flag, so the old `u?.bot` guard would let the
    // bot's own reaction leak through and echo. Guarding by id must skip it.
    client.emit("messageReactionAdd", reaction(), { id: botId });
    expect(onReaction).not.toHaveBeenCalled();
  });

  it("dispatches a normal user's reaction add", () => {
    const client = fakeClient();
    const onReaction = vi.fn();
    attachDiscordListener({
      client: client as any,
      botUserId: botId,
      onTurn: vi.fn(),
      onCommand: vi.fn(),
      onReaction,
    });
    client.emit("messageReactionAdd", reaction(), { id: "U1", bot: false });
    expect(onReaction).toHaveBeenCalledWith(
      expect.objectContaining({ added: true, conversationKey: "c1" }),
    );
  });

  it("skips the bot's own reaction removal by id (partial user)", () => {
    const client = fakeClient();
    const onReaction = vi.fn();
    attachDiscordListener({
      client: client as any,
      botUserId: botId,
      onTurn: vi.fn(),
      onCommand: vi.fn(),
      onReaction,
    });
    client.emit("messageReactionRemove", reaction(), { id: botId });
    expect(onReaction).not.toHaveBeenCalled();
  });
});
