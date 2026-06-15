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
    mentions: { has: () => false },
    channel: { isDMBased: () => false },
    ...over,
  };
}

describe("attachDiscordListener", () => {
  it("emits a turn when the bot is mentioned", () => {
    const client = fakeClient();
    const onTurn = vi.fn();
    attachDiscordListener({ client: client as any, botUserId: botId, onTurn, onCommand: vi.fn() });
    client.emit("messageCreate", message({ mentions: { has: () => true }, content: "<@bot-1> hi" }));
    expect(onTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: "c1",
        replyTarget: { channelId: "c1", guildId: "g1" },
        senderUserId: "u1",
      }),
    );
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

  it("forwards a chat-input command via onCommand", () => {
    const client = fakeClient();
    const onCommand = vi.fn();
    attachDiscordListener({ client: client as any, botUserId: botId, onTurn: vi.fn(), onCommand });
    client.emit("interactionCreate", {
      isChatInputCommand: () => true,
      commandName: "triage",
      channelId: "c1",
      guildId: "g1",
      user: { id: "u1", username: "ann", globalName: "Ann" },
      options: { data: [{ name: "priority", value: "high" }] },
    });
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "triage",
        conversationKey: "c1",
        rawOptions: { priority: "high" },
      }),
    );
  });
});
