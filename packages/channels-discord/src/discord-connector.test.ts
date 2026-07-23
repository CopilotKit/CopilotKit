import { describe, it, expect, vi } from "vitest";

/**
 * `WebClientDiscordConnector` owns the discord.js `Client`/`REST` construction
 * (Task B/discord gut) — mock the small slice of discord.js this file + its
 * transitive `./commands.js` import actually touch (Client/REST/GatewayIntentBits/
 * Partials/MessageFlags/Routes), mirroring how `channels-slack/src/adapter.test.ts`
 * mocks `@slack/bolt`'s `App`. Every other discord.js consumer in this package
 * (render/components-v2.ts, render/modal.ts) is untouched by this mock — this
 * file never imports `adapter.js`, so those real Builders never enter the module
 * graph here.
 */
// `vi.mock` factories are hoisted above every top-level statement, so the
// `FakeClient` class (and the array capturing constructed instances) must be
// created via `vi.hoisted` rather than a plain top-level `class`/`let` — a
// direct reference would hit the TDZ (class declarations aren't hoisted like
// `var`).
const { FakeClient, createdClients } = vi.hoisted(() => {
  const createdClients: any[] = [];
  class FakeClient {
    private handlers: Record<string, Array<(...a: any[]) => unknown>> = {};
    user: { id: string } | undefined = undefined;
    channels = { fetch: vi.fn() };
    users = { fetch: vi.fn() };
    guilds = { cache: new Map() };

    constructor() {
      createdClients.push(this);
    }
    once(event: string, cb: (...a: any[]) => unknown) {
      this.on(event, cb);
    }
    on(event: string, cb: (...a: any[]) => unknown) {
      (this.handlers[event] ??= []).push(cb);
    }
    async login(_token: string) {
      return "ok";
    }
    async destroy() {}
    /** Test helper: fire every listener registered for `event`, awaiting each. */
    async emit(event: string, ...args: unknown[]) {
      for (const cb of this.handlers[event] ?? []) await cb(...args);
    }
  }
  return { FakeClient, createdClients };
});

vi.mock("discord.js", () => ({
  Client: FakeClient,
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    MessageContent: 3,
    DirectMessages: 4,
    GuildMembers: 5,
    GuildMessageReactions: 6,
    DirectMessageReactions: 7,
  },
  Partials: { Channel: 1, Message: 2, Reaction: 3 },
  MessageFlags: { Ephemeral: 64 },
  REST: class {
    put = vi.fn(async () => undefined);
    setToken() {
      return this;
    }
  },
  Routes: {
    applicationCommands: (appId: string) => `/apps/${appId}/commands`,
    applicationGuildCommands: (appId: string, guildId: string) =>
      `/apps/${appId}/guilds/${guildId}/commands`,
  },
}));

import { WebClientDiscordConnector } from "./discord-connector.js";
import type { DiscordIngressConfig } from "./discord-connector.js";

function sink() {
  return {
    onTurn: vi.fn(),
    onInteraction: vi.fn(),
    onCommand: vi.fn(),
    onThreadStarted: vi.fn(),
    onReaction: vi.fn(),
    onModalSubmit: vi.fn(async () => ({})),
    onModalClose: vi.fn(),
  };
}

function makeConnector() {
  createdClients.length = 0;
  const connector = new WebClientDiscordConnector({
    botToken: "t",
    appId: "app",
  });
  const client = createdClients[0]!;
  return { connector, client };
}

/**
 * `startIngress` now awaits the Gateway `ready` event before resolving (so the
 * adapter's `botUserId` is always correct once `start()` returns, unlike the
 * pre-gut adapter which could resolve before `ready` fired). Every test that
 * doesn't specifically exercise that timing fires `ready` while the
 * `startIngress` promise is still pending, via this helper.
 */
async function startedConnector(config?: Partial<DiscordIngressConfig>) {
  const { connector, client } = makeConnector();
  const s = config?.sink ?? sink();
  const started = connector.startIngress({
    sink: s,
    resolveUser: config?.resolveUser ?? (async (id: string) => ({ id })),
  });
  client.user = { id: "bot-1" };
  await client.emit("ready");
  await started;
  return { connector, client, sink: s };
}

describe("WebClientDiscordConnector.startIngress", () => {
  it("logs in with the bot token and resolves botUserId once ready fires", async () => {
    const { connector, client } = makeConnector();
    const started = connector.startIngress({
      sink: sink(),
      resolveUser: async (id) => ({ id }),
    });
    client.user = { id: "bot-1" };
    await client.emit("ready");
    expect(await started).toEqual({ botUserId: "bot-1" });
  });

  it("registerCommands stashes an empty list without publishing (an empty PUT would clear all commands)", async () => {
    const { connector, client } = makeConnector();
    const started = connector.startIngress({
      sink: sink(),
      resolveUser: async (id) => ({ id }),
    });
    // Called BEFORE `ready` fires — just stashes the (empty) list.
    connector.registerCommands([]);
    client.user = { id: "bot-1" };
    await client.emit("ready"); // publishCommands guard: empty list → no PUT
    await started;
    const rest = (
      connector as unknown as { rest: { put: ReturnType<typeof vi.fn> } }
    ).rest;
    expect(rest.put).not.toHaveBeenCalled();
  });

  it("publishes immediately when registerCommands is called after ready", async () => {
    const { connector } = await startedConnector();
    connector.registerCommands([{ name: "agent", description: "x" }]);
    await Promise.resolve();
    await Promise.resolve();
    const rest = (
      connector as unknown as { rest: { put: ReturnType<typeof vi.fn> } }
    ).rest;
    expect(rest.put).toHaveBeenCalledTimes(1);
  });

  it("interactionCreate dispatch failures are caught, not left unhandled", async () => {
    const s = sink();
    s.onInteraction.mockRejectedValue(new Error("dispatch boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = await startedConnector({ sink: s });

    const deferUpdate = vi.fn(async () => {});
    const interaction = {
      isButton: () => true,
      isStringSelectMenu: () => false,
      id: "int-1",
      customId: "btn-1",
      channelId: "c1",
      user: { id: "u1", username: "ada" },
      message: { id: "m1" },
      deferUpdate,
    };
    await client.emit("interactionCreate", interaction);

    expect(deferUpdate).toHaveBeenCalledTimes(1);
    expect(s.onInteraction).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith(
      "[bot-discord] interaction dispatch failed:",
      expect.any(Error),
    );
    errSpy.mockRestore();
  });

  function fakeModalSubmit(over: Record<string, unknown>) {
    return {
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      customId: "triage",
      channelId: "c1",
      guildId: "g1",
      user: { id: "u1", username: "ada" },
      fields: {
        fields: new Map([["summary", { customId: "summary", value: "x" }]]),
      },
      replied: false,
      deferred: false,
      ...over,
    };
  }

  it("modal-submit from a slash command acks with deferReply (ephemeral), not deferUpdate", async () => {
    const s = sink();
    const { client } = await startedConnector({ sink: s });

    const deferReply = vi.fn(async (_opts: { flags: number }) => {});
    const deferUpdate = vi.fn(async () => {
      throw new Error("interaction not from message");
    });
    const interaction = fakeModalSubmit({
      isFromMessage: () => false,
      deferReply,
      deferUpdate,
    });
    await client.emit("interactionCreate", interaction);

    expect(s.onModalSubmit).toHaveBeenCalledTimes(1);
    expect(deferReply).toHaveBeenCalledTimes(1);
    expect(deferReply.mock.calls[0]?.[0]).toMatchObject({ flags: 64 });
    expect(deferUpdate).not.toHaveBeenCalled();
  });

  it("modal-submit from a message component acks with deferUpdate, not deferReply", async () => {
    const s = sink();
    const { client } = await startedConnector({ sink: s });

    const deferReply = vi.fn(async () => {});
    const deferUpdate = vi.fn(async () => {});
    const interaction = fakeModalSubmit({
      isFromMessage: () => true,
      deferReply,
      deferUpdate,
    });
    await client.emit("interactionCreate", interaction);

    expect(s.onModalSubmit).toHaveBeenCalledTimes(1);
    expect(deferUpdate).toHaveBeenCalledTimes(1);
    expect(deferReply).not.toHaveBeenCalled();
  });

  it("openModal opens a modal for a slash-command interaction (commandPending registry)", async () => {
    const { connector, client } = await startedConnector();

    const showModal = vi.fn(async () => {});
    const interaction = {
      isChatInputCommand: () => true,
      id: "cmd-trigger",
      commandName: "file-issue",
      channelId: "c1",
      guildId: "g1",
      user: { id: "u1", username: "ada" },
      options: { data: [] },
      showModal,
    };
    // Fire-and-forget: the command handler awaits onCommand + settle, but
    // openModal below races it (a real handler opens the modal from inside
    // onCommand before settle acks).
    const emitted = client.emit("interactionCreate", interaction);

    const res = await connector.openModal("cmd-trigger", { fake: "modal" });
    await emitted;

    expect(showModal).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ ok: true });
  });

  it("openModal returns ok:false for an unknown/already-acknowledged trigger", async () => {
    const { connector } = await startedConnector();
    const res = await connector.openModal("no-such-trigger", { fake: "modal" });
    expect(res.ok).toBe(false);
  });
});

describe("WebClientDiscordConnector egress ops", () => {
  it("sendMessage/editMessage/deleteMessage go through the fetched channel", async () => {
    const { connector, client } = makeConnector();
    const sent = {
      id: "m1",
      edit: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const channel = {
      id: "c1",
      send: vi.fn(async () => sent),
      messages: { fetch: vi.fn(async () => sent) },
    };
    client.channels.fetch.mockResolvedValue(channel);

    const res = await connector.sendMessage("c1", "hi");
    expect(res).toEqual({ id: "m1" });
    expect(channel.send).toHaveBeenCalledWith("hi");

    await connector.editMessage("c1", "m1", "bye");
    expect(sent.edit).toHaveBeenCalledWith("bye");

    await connector.deleteMessage("c1", "m1");
    expect(sent.delete).toHaveBeenCalledTimes(1);
  });

  it("removeReaction finds a reaction cached under the bare (VS16-stripped) codepoint and removes the bot's own id", async () => {
    const removeUser = vi.fn(async () => undefined);
    const msg = {
      reactions: {
        cache: new Map([
          // Discord keys hearts by the BARE codepoint (no trailing U+FE0F).
          ["❤", { users: { remove: removeUser } }],
        ]),
      },
    };
    const channel = {
      id: "c1",
      send: vi.fn(),
      messages: { fetch: vi.fn(async () => msg) },
    };
    const { connector, client } = await startedConnector();
    client.channels.fetch.mockResolvedValue(channel);

    await connector.removeReaction("c1", "m1", "❤️"); // qualified form (U+2764 U+FE0F)
    expect(removeUser).toHaveBeenCalledWith("bot-1");
  });

  it("fetchStarterMessage returns undefined for a non-thread channel", async () => {
    const { connector, client } = makeConnector();
    const channel = { id: "c1", send: vi.fn(), messages: { fetch: vi.fn() } };
    client.channels.fetch.mockResolvedValue(channel);
    const starter = await connector.fetchStarterMessage("c1");
    expect(starter).toBeUndefined();
  });
});
