import { describe, it, expect, vi } from "vitest";
import { MessageFlags } from "discord.js";
import { DiscordAdapter, discord } from "./adapter.js";

function fakeClient() {
  const handlers: Record<string, (a: unknown) => void> = {};
  return {
    on(e: string, cb: (a: unknown) => void) {
      handlers[e] = cb;
    },
    once(e: string, cb: (a: unknown) => void) {
      handlers[e] = cb;
    },
    login: vi.fn(async () => "ok"),
    destroy: vi.fn(async () => {}),
    user: { id: "bot-1" },
    channels: {
      fetch: vi.fn(async () => ({
        id: "c1",
        send: vi.fn(async () => ({ id: "m1" })),
      })),
    },
    emit(e: string, a: unknown) {
      handlers[e]?.(a);
    },
  };
}

const sink = () => ({
  onTurn: vi.fn(),
  onInteraction: vi.fn(),
  onCommand: vi.fn(),
  onModalSubmit: vi.fn(),
});

describe("DiscordAdapter", () => {
  it("advertises Discord capabilities", () => {
    const a = new DiscordAdapter({ botToken: "t", appId: "app" });
    expect(a.platform).toBe("discord");
    expect(a.capabilities.supportsModals).toBe(true);
    expect(a.capabilities.supportsTyping).toBe(true);
    expect(a.capabilities.supportsReactions).toBe(true);
    expect(a.capabilities.supportsEphemeral).toBe(false);
    expect(a.capabilities.supportsStreaming).toBe(true);
    expect(a.capabilities.maxBlocksPerMessage).toBe(40);
    expect(a.ackDeadlineMs).toBe(3000);
  });

  it("renders IR to a components-v2 container", () => {
    const a = new DiscordAdapter({ botToken: "t", appId: "app" });
    const out = a.render([
      {
        type: "message",
        props: { children: { type: "text", props: { value: "hi" } } },
      },
    ]);
    expect(out).toBeTruthy(); // ContainerBuilder
  });

  it("logs in and captures the bot id on start, publishing commands on ready", async () => {
    const client = fakeClient();
    const put = vi.fn(async () => {});
    const a = new DiscordAdapter(
      { botToken: "t", appId: "app" },
      { client: client as never, rest: { put } as never },
    );
    await a.start(sink() as never);
    expect(client.login).toHaveBeenCalledWith("t");
    expect(put).not.toHaveBeenCalled();
    // Stash a non-empty command list — publishCommands guards an empty list (an
    // empty PUT would clear all of the bot's commands), so a command must be
    // registered for the once("ready") publish to PUT anything.
    a.registerCommands([{ name: "agent", description: "x" }]);
    client.emit("ready", client); // discord.js passes the ready client
    // ready handler is async; flush microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("discord() factory returns an adapter", () => {
    expect(discord({ botToken: "t", appId: "app" })).toBeInstanceOf(
      DiscordAdapter,
    );
  });

  it("stream() edits each posted message with ITS own chunk, not all-on-first", async () => {
    // Each send() mints a distinct id and its own edit spy, so we can assert
    // the per-message Map wiring (chunk N → message N), not chunk-on-#0.
    const posted: Array<{ id: string; edit: ReturnType<typeof vi.fn> }> = [];
    let n = 0;
    const channel = {
      id: "c1",
      send: vi.fn(async () => {
        const m = { id: `m${++n}`, edit: vi.fn(async () => {}) };
        posted.push(m);
        return m;
      }),
      messages: { fetch: vi.fn() },
    };
    const client = {
      ...fakeClient(),
      channels: { fetch: vi.fn(async () => channel) },
    };
    const a = new DiscordAdapter(
      { botToken: "t", appId: "app" },
      { client: client as never, rest: { put: vi.fn() } as never },
    );

    // Two chunks: >2000 chars forces ChunkedMessageStream to post a second
    // Discord message. Distinct markers per half let us check routing.
    const first = "A".repeat(1500) + "\n";
    const second = "B".repeat(1500);
    async function* chunks() {
      yield first;
      yield second;
    }
    const ref = await a.stream({ channelId: "c1" } as never, chunks());

    // Two messages posted, ref points at the first.
    expect(posted.length).toBe(2);
    expect(ref.id).toBe("m1");

    // The first message's final edit must NOT contain the second chunk's
    // marker, and the second message's final edit must contain it. If the
    // Map were ignored (old bug), every edit would land on message #0.
    const firstFinal = posted[0]!.edit.mock.calls.at(-1)?.[0] as string;
    const secondFinal = posted[1]!.edit.mock.calls.at(-1)?.[0] as string;
    expect(firstFinal).toContain("A");
    expect(firstFinal).not.toContain("B");
    expect(secondFinal).toContain("B");
  });

  it("resolveUser does NOT cache the bare-id fallback on transient fetch failure", async () => {
    const fetch = vi
      .fn()
      // first call throws → bare-id fallback, must not be cached
      .mockRejectedValueOnce(new Error("rate limited"))
      // second call succeeds → real user
      .mockResolvedValueOnce({ id: "u1", globalName: "Ada", username: "ada" });
    const client = { ...fakeClient(), users: { fetch } };
    const a = new DiscordAdapter(
      { botToken: "t", appId: "app" },
      { client: client as never, rest: { put: vi.fn() } as never },
    );

    const first = await a.resolveUser("u1");
    expect(first).toEqual({ id: "u1" }); // bare-id fallback

    const second = await a.resolveUser("u1");
    // A retry happened (not served from cache) and resolved the real user.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(second).toEqual({ id: "u1", name: "Ada", handle: "ada" });
  });

  it("getMessages excludes the bot's own streaming placeholders from history", async () => {
    // Mix: a user message, a real bot reply, and a bot streaming placeholder.
    // fetch() returns a Map-like with values(); getMessages reverses + filters.
    const messages = [
      {
        id: "m1",
        content: "hey bot",
        author: { id: "u1", bot: false, username: "ann", globalName: "Ann" },
      },
      {
        id: "m2",
        content: "_thinking…_", // bot placeholder — must be excluded
        author: { id: "bot-1", bot: true, username: "bot" },
      },
      {
        id: "m3",
        content: "here is the real answer",
        author: { id: "bot-1", bot: true, username: "bot" },
      },
    ];
    const channel = {
      id: "c1",
      send: vi.fn(async () => ({ id: "x" })), // fetchSendable requires `send`
      messages: {
        fetch: vi.fn(async () => new Map(messages.map((m) => [m.id, m]))),
      },
    };
    const client = {
      ...fakeClient(),
      channels: { fetch: vi.fn(async () => channel) },
    };
    const a = new DiscordAdapter(
      { botToken: "t", appId: "app" },
      { client: client as never, rest: { put: vi.fn() } as never },
    );

    const out = await a.getMessages({ channelId: "c1" } as never);
    const texts = out.map((m) => m.text);
    expect(texts).toContain("hey bot");
    expect(texts).toContain("here is the real answer");
    expect(texts).not.toContain("_thinking…_");
    expect(out).toHaveLength(2);
  });

  it("addReaction falls back to the target channel when the reacted ref has no channelId", async () => {
    // The reacted ref the bot-ui example sends is just `{ id }` (no channelId);
    // the channel must come from the conversation's reply target — parity with
    // Slack/Telegram. Regression: previously Discord resolved fetchSendable("")
    // and the react silently failed (acks never fired on Discord).
    const message = { react: vi.fn(async () => undefined) };
    const channel = {
      id: "c1",
      send: vi.fn(async () => ({ id: "x" })),
      messages: { fetch: vi.fn(async () => message) },
    };
    const channelsFetch = vi.fn(async (id: string) => {
      if (!id) throw new Error("channel  is not sendable"); // empty id is the bug
      return channel;
    });
    const client = { ...fakeClient(), channels: { fetch: channelsFetch } };
    const a = new DiscordAdapter(
      { botToken: "t", appId: "app" },
      { client: client as never, rest: { put: vi.fn() } as never },
    );

    const res = await a.addReaction(
      { channelId: "c1" } as never,
      { id: "m1" } as never,
      "eyes" as never,
    );
    expect(res).toEqual({ ok: true });
    // Resolved the TARGET channel, never the empty string.
    expect(channelsFetch).toHaveBeenCalledWith("c1");
    expect(channelsFetch).not.toHaveBeenCalledWith("");
    expect(message.react).toHaveBeenCalled();
  });

  it("interactionCreate dispatch failures are caught, not left unhandled", async () => {
    const client = fakeClient();
    const a = new DiscordAdapter(
      { botToken: "t", appId: "app" },
      { client: client as never, rest: { put: vi.fn() } as never },
    );
    const s = sink();
    // sink.onInteraction rejects — without the try/catch this becomes an
    // unhandled promise rejection inside the event handler.
    s.onInteraction.mockRejectedValue(new Error("dispatch boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await a.start(s as never);

    // A well-formed button interaction that decodes to an event.
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

    // emit() invokes the (async) handler synchronously; the body runs across
    // several microtask turns (deferUpdate → decode → dispatch → catch). If the
    // rejection escaped the handler, it would surface as an unhandled rejection
    // (and crash under --unhandled-rejections=throw) rather than the logged path.
    client.emit("interactionCreate", interaction);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(deferUpdate).toHaveBeenCalledTimes(1);
    expect(s.onInteraction).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith(
      "[bot-discord] interaction dispatch failed:",
      expect.any(Error),
    );
    errSpy.mockRestore();
  });

  // A modal opened from a slash command yields a ModalSubmitInteraction with
  // no originating message — `deferUpdate()` is invalid there and throws. The
  // ack must use `deferReply` (ephemeral) for that origin, and must never throw
  // uncaught.
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
    const client = fakeClient();
    const a = new DiscordAdapter(
      { botToken: "t", appId: "app" },
      { client: client as never, rest: { put: vi.fn() } as never },
    );
    const s = sink();
    await a.start(s as never);

    // Slash-command origin: isFromMessage() === false. deferUpdate would throw
    // for such an interaction in discord.js, so simulate that to prove the
    // correct method is chosen (and that a stray call would surface).
    const deferReply = vi.fn(async (_opts: { flags: number }) => {});
    const deferUpdate = vi.fn(async () => {
      throw new Error("interaction not from message");
    });
    const interaction = fakeModalSubmit({
      isFromMessage: () => false,
      deferReply,
      deferUpdate,
    });

    client.emit("interactionCreate", interaction);
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(s.onModalSubmit).toHaveBeenCalledTimes(1);
    expect(deferReply).toHaveBeenCalledTimes(1);
    // ephemeral flag passed
    expect(deferReply.mock.calls[0]?.[0]).toMatchObject({
      flags: MessageFlags.Ephemeral,
    });
    expect(deferUpdate).not.toHaveBeenCalled();
  });

  it("modal-submit from a message component acks with deferUpdate, not deferReply", async () => {
    const client = fakeClient();
    const a = new DiscordAdapter(
      { botToken: "t", appId: "app" },
      { client: client as never, rest: { put: vi.fn() } as never },
    );
    const s = sink();
    await a.start(s as never);

    const deferReply = vi.fn(async () => {});
    const deferUpdate = vi.fn(async () => {});
    const interaction = fakeModalSubmit({
      isFromMessage: () => true,
      deferReply,
      deferUpdate,
    });

    client.emit("interactionCreate", interaction);
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(s.onModalSubmit).toHaveBeenCalledTimes(1);
    expect(deferUpdate).toHaveBeenCalledTimes(1);
    expect(deferReply).not.toHaveBeenCalled();
  });

  it("openModal opens a modal for a slash-command interaction (commandPending registry)", async () => {
    // The bug: openModal only consulted the component registry (`pending`), so a
    // modal opened from a slash command — whose live interaction lives in
    // `commandPending` — silently failed. openModal must try BOTH registries.
    const client = fakeClient();
    const a = new DiscordAdapter(
      { botToken: "t", appId: "app" },
      { client: client as never, rest: { put: vi.fn() } as never },
    );
    // `commandPending` is constructed in start(); spin it up with the fake client.
    await a.start(sink() as never);

    // Register a live slash-command interaction in the COMMAND registry only
    // (not the component `pending` one), then open a modal against its trigger.
    const showModal = vi.fn(async () => {});
    const triggerId = (
      a as unknown as {
        commandPending: {
          register(i: { id: string; showModal: unknown }): string;
        };
      }
    ).commandPending.register({ id: "cmdTrigger", showModal });

    // A minimal valid modal IR: a <Modal> root with no children renders fine
    // (zero text inputs is allowed; renderDiscordModal only throws on
    // unsupported elements or >5 inputs).
    const modalIr = [
      { type: "modal", props: { callbackId: "x", title: "t", children: [] } },
    ];
    const res = await a.openModal(
      { channelId: "c1" } as never,
      triggerId,
      modalIr as never,
    );

    expect(showModal).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ ok: true });
  });

  it("registerCommands never clears on empty, and publishes when already ready", async () => {
    const client = fakeClient();
    const put = vi.fn(
      async (_route: string, _opts: { body: unknown }) => undefined,
    );
    const a = new DiscordAdapter(
      { botToken: "t", appId: "app" },
      { client: client as never, rest: { put } as never },
    );
    await a.start(sink() as never);

    // (i) An empty command list must NOT PUT — an empty PUT clears all of the
    // bot's registered commands. Register empty, then fire `ready`.
    a.registerCommands([]);
    client.emit("ready", client);
    await Promise.resolve();
    await Promise.resolve();
    expect(put).not.toHaveBeenCalled();

    // (ii) Registering after `ready` must publish immediately (the once("ready")
    // publish already ran, so a later registerCommands has to PUT itself).
    a.registerCommands([{ name: "agent", description: "x" }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(put).toHaveBeenCalledTimes(1);
    // The published body carries the registered command.
    const body = put.mock.calls[0]?.[1] as { body: Array<{ name: string }> };
    expect(body.body).toEqual([
      expect.objectContaining({ name: "agent", description: "x" }),
    ]);
  });
});
