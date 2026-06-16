import { describe, it, expect, vi } from "vitest";
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
});

describe("DiscordAdapter", () => {
  it("advertises Discord capabilities (modals off in v1)", () => {
    const a = new DiscordAdapter({ botToken: "t", appId: "app" });
    expect(a.platform).toBe("discord");
    expect(a.capabilities.supportsModals).toBe(false);
    expect(a.capabilities.supportsTyping).toBe(true);
    expect(a.capabilities.supportsReactions).toBe(true);
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

  it("delivers inbound attachments to the sink as multimodal content parts", async () => {
    const client = fakeClient();
    const a = new DiscordAdapter(
      { botToken: "t", appId: "app" },
      { client: client as never, rest: { put: vi.fn() } as never },
    );
    const s = sink();
    await a.start(s as never);
    client.emit("ready", client);
    await Promise.resolve();

    // Stub the global fetch the download path uses so no real network happens.
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      arrayBuffer: async () => pngBytes.buffer,
    } as never);

    client.emit("messageCreate", {
      author: { id: "u1", bot: false, username: "ann", globalName: "Ann" },
      content: "<@bot-1> look at this",
      channelId: "c1",
      guildId: "g1",
      mentions: {
        has: () => true,
        users: { has: (q: string) => q === "bot-1" },
      },
      channel: { isDMBased: () => false },
      attachments: {
        values: () =>
          [
            {
              url: "https://cdn.discord/a.png",
              name: "a.png",
              contentType: "image/png",
              size: pngBytes.length,
            },
          ][Symbol.iterator](),
      },
    });
    // Let the listener's async onTurn (download + resolveUser) settle.
    await new Promise((r) => setTimeout(r, 0));

    expect(s.onTurn).toHaveBeenCalledTimes(1);
    const turn = s.onTurn.mock.calls[0]![0];
    expect(turn.contentParts).toEqual([
      // The leading mention is stripped by the listener, leaving the text body.
      { type: "text", text: "look at this" },
      {
        type: "image",
        source: {
          type: "data",
          value: Buffer.from(pngBytes).toString("base64"),
          mimeType: "image/png",
        },
      },
    ]);
    fetchSpy.mockRestore();
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
});
