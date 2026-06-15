import { MessageFlags } from "discord.js";
import { describe, it, expect, vi } from "vitest";
import { attachDiscordListener } from "./discord-listener.js";

function fakeClient() {
  const handlers: Record<string, (arg: unknown) => void> = {};
  return {
    on(event: string, cb: (arg: unknown) => void) {
      handlers[event] = cb;
    },
    emit(event: string, arg: unknown) {
      handlers[event]?.(arg);
    },
  };
}

const botId = "bot-1";

function message(over: Record<string, unknown>) {
  return {
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
  it("emits a turn when the bot is mentioned", () => {
    const client = fakeClient();
    const onTurn = vi.fn();
    attachDiscordListener({ client: client as any, botUserId: botId, onTurn, onCommand: vi.fn() });
    client.emit(
      "messageCreate",
      message({
        mentions: { has: () => true, users: { has: (q: string) => q === "bot-1" } },
        content: "<@bot-1> hi",
      }),
    );
    expect(onTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: "c1",
        replyTarget: { channelId: "c1", guildId: "g1" },
        senderUserId: "u1",
      }),
    );
  });

  it("does not answer a role / @everyone mention that only matches via mentions.has", () => {
    const client = fakeClient();
    const onTurn = vi.fn();
    attachDiscordListener({ client: client as any, botUserId: botId, onTurn, onCommand: vi.fn() });
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

  it("emits a turn for a DM even without a mention", () => {
    const client = fakeClient();
    const onTurn = vi.fn();
    attachDiscordListener({ client: client as any, botUserId: botId, onTurn, onCommand: vi.fn() });
    client.emit("messageCreate", message({ channel: { isDMBased: () => true }, guildId: null }));
    expect(onTurn).toHaveBeenCalledTimes(1);
  });

  it("ignores the bot's own messages", () => {
    const client = fakeClient();
    const onTurn = vi.fn();
    attachDiscordListener({ client: client as any, botUserId: botId, onTurn, onCommand: vi.fn() });
    client.emit("messageCreate", message({ author: { id: "bot-1", bot: true } }));
    expect(onTurn).not.toHaveBeenCalled();
  });

  it("ignores other bots", () => {
    const client = fakeClient();
    const onTurn = vi.fn();
    attachDiscordListener({ client: client as any, botUserId: botId, onTurn, onCommand: vi.fn() });
    client.emit("messageCreate", message({ author: { id: "u2", bot: true } }));
    expect(onTurn).not.toHaveBeenCalled();
  });

  it("resolves a getter-form botUserId per event", () => {
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
        mentions: { has: (q: string) => q === "bot-1", users: { has: (q: string) => q === "bot-1" } },
        content: "<@bot-1> hi",
      }),
    );
    expect(onTurn).toHaveBeenCalledWith(
      expect.objectContaining({ conversationKey: "c1", senderUserId: "u1" }),
    );
  });

  it("forwards a chat-input command via onCommand and acks the interaction", async () => {
    const client = fakeClient();
    const onCommand = vi.fn();
    const reply = vi.fn().mockResolvedValue(undefined);
    attachDiscordListener({ client: client as any, botUserId: botId, onTurn: vi.fn(), onCommand });
    client.emit("interactionCreate", {
      isChatInputCommand: () => true,
      commandName: "triage",
      channelId: "c1",
      guildId: "g1",
      user: { id: "u1", username: "ann", globalName: "Ann" },
      options: { data: [{ name: "priority", value: "high" }] },
      reply,
    });
    // The ack must happen synchronously within Discord's 3s window; let the
    // async handler settle so the subsequent onCommand dispatch runs.
    await Promise.resolve();
    await Promise.resolve();
    expect(reply).toHaveBeenCalledTimes(1);
    const ackArg = reply.mock.calls[0][0];
    expect(ackArg.flags).toBe(MessageFlags.Ephemeral);
    expect(typeof ackArg.content).toBe("string");
    expect(ackArg.content.length).toBeGreaterThan(0);
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "triage",
        conversationKey: "c1",
        rawOptions: { priority: "high" },
      }),
    );
  });

  it("does not ack or dispatch a non-command interaction", async () => {
    const client = fakeClient();
    const onCommand = vi.fn();
    const reply = vi.fn().mockResolvedValue(undefined);
    attachDiscordListener({ client: client as any, botUserId: botId, onTurn: vi.fn(), onCommand });
    client.emit("interactionCreate", {
      isChatInputCommand: () => false,
      commandName: "triage",
      channelId: "c1",
      guildId: "g1",
      user: { id: "u1" },
      options: { data: [] },
      reply,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(reply).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("catches a rejecting onTurn handler instead of letting it escape", async () => {
    const client = fakeClient();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onTurn = vi.fn().mockRejectedValue(new Error("boom"));
    attachDiscordListener({ client: client as any, botUserId: botId, onTurn, onCommand: vi.fn() });
    expect(() =>
      client.emit(
        "messageCreate",
        message({
          mentions: { has: () => true, users: { has: (q: string) => q === "bot-1" } },
          content: "<@bot-1> hi",
        }),
      ),
    ).not.toThrow();
    // Let the rejected promise settle so the .catch runs.
    await Promise.resolve();
    await Promise.resolve();
    expect(errSpy).toHaveBeenCalledWith("[bot-discord] onTurn handler failed:", expect.any(Error));
    errSpy.mockRestore();
  });
});
