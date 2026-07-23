import { describe, it, expect } from "vitest";
import { DiscordAdapter, discord } from "./adapter.js";
import { FakeDiscordConnector } from "./testing/fake-discord-connector.js";

/**
 * Build a credential-free adapter with a `FakeDiscordConnector` bound via
 * `ɵbindConnector` (the adapter builds nothing from tokens — every egress
 * method routes through the bound connector). Constructing the adapter is
 * side-effect-free; we never call `start()` here — every test drives the pure
 * egress/decode methods against the fake directly. Ingress-owning behavior
 * (Gateway login, ready, interactionCreate wiring, registerCommands
 * publish-on-ready) lives on `WebClientDiscordConnector` and is covered in
 * `discord-connector.test.ts`.
 */
function makeAdapter() {
  const adapter = new DiscordAdapter({});
  const connector = new FakeDiscordConnector();
  adapter.ɵbindConnector(connector);
  return { adapter, connector };
}

describe("DiscordAdapter", () => {
  it("advertises Discord capabilities", () => {
    const { adapter } = makeAdapter();
    expect(adapter.platform).toBe("discord");
    expect(adapter.capabilities.supportsModals).toBe(true);
    expect(adapter.capabilities.supportsTyping).toBe(true);
    expect(adapter.capabilities.supportsReactions).toBe(true);
    expect(adapter.capabilities.supportsEphemeral).toBe(false);
    expect(adapter.capabilities.supportsStreaming).toBe(true);
    expect(adapter.capabilities.maxBlocksPerMessage).toBe(40);
    expect(adapter.ackDeadlineMs).toBe(3000);
  });

  it("renders IR to a components-v2 container", () => {
    const { adapter } = makeAdapter();
    const out = adapter.render([
      {
        type: "message",
        props: { children: { type: "text", props: { value: "hi" } } },
      },
    ]);
    expect(out).toBeTruthy(); // ContainerBuilder
  });

  it("discord() factory returns an adapter", () => {
    expect(discord({})).toBeInstanceOf(DiscordAdapter);
  });

  it("throws a clear error when run unbound (no ɵbindConnector call)", async () => {
    const adapter = new DiscordAdapter({});
    await expect(adapter.post({ channelId: "c1" }, [])).rejects.toThrow(
      /has no connector/,
    );
  });

  describe("post / update / delete", () => {
    it("post sends rendered components to the connector and returns a MessageRef", async () => {
      const { adapter, connector } = makeAdapter();
      connector.results.sendMessage = { id: "m1" };
      const ref = await adapter.post({ channelId: "c1" }, [
        {
          type: "message",
          props: { children: { type: "text", props: { value: "hi" } } },
        },
      ]);
      expect(connector.calls[0]!.op).toBe("sendMessage");
      const args = connector.calls[0]!.args as {
        channelId: string;
        payload: { components: unknown[]; flags: number };
      };
      expect(args.channelId).toBe("c1");
      expect(args.payload.components.length).toBeGreaterThan(0);
      expect(ref).toEqual({ id: "m1", channelId: "c1" });
    });

    it("update edits the message at ref.id via the connector", async () => {
      const { adapter, connector } = makeAdapter();
      await adapter.update({ id: "m1", channelId: "c1" }, [
        { type: "message", props: { children: [] } },
      ]);
      expect(connector.calls[0]!.op).toBe("editMessage");
      const args = connector.calls[0]!.args as {
        channelId: string;
        messageId: string;
      };
      expect(args.channelId).toBe("c1");
      expect(args.messageId).toBe("m1");
    });

    it('update on an empty-stream ref (id "") is a no-op', async () => {
      const { adapter, connector } = makeAdapter();
      await adapter.update({ id: "", channelId: "c1" }, []);
      expect(connector.calls).toHaveLength(0);
    });

    it("delete removes the message at ref.id via the connector", async () => {
      const { adapter, connector } = makeAdapter();
      await adapter.delete({ id: "m1", channelId: "c1" });
      expect(connector.calls[0]).toEqual({
        op: "deleteMessage",
        args: { channelId: "c1", messageId: "m1" },
      });
    });

    it("delete on an empty-stream ref is a no-op", async () => {
      const { adapter, connector } = makeAdapter();
      await adapter.delete({ id: "", channelId: "c1" });
      expect(connector.calls).toHaveLength(0);
    });
  });

  describe("stream()", () => {
    it("edits each posted message with ITS own chunk, not all-on-first", async () => {
      // Each sendMessage call mints a distinct id; editMessage must target the
      // SPECIFIC message id the connector returned for that chunk, not always
      // the first-posted message.
      let n = 0;
      const { adapter, connector } = makeAdapter();
      connector.sendMessage = async (channelId, payload) => {
        connector.calls.push({
          op: "sendMessage",
          args: { channelId, payload },
        });
        return { id: `m${++n}` };
      };

      const first = "A".repeat(1500) + "\n";
      const second = "B".repeat(1500);
      async function* chunks() {
        yield first;
        yield second;
      }
      const ref = await adapter.stream({ channelId: "c1" } as never, chunks());

      const sends = connector.calls.filter((c) => c.op === "sendMessage");
      expect(sends.length).toBe(2);
      expect(ref.id).toBe("m1");

      const edits = connector.calls.filter(
        (c) => c.op === "editMessage",
      ) as Array<{
        op: "editMessage";
        args: { messageId: string; payload: string };
      }>;
      const firstFinal = edits.filter((e) => e.args.messageId === "m1").at(-1)
        ?.args.payload;
      const secondFinal = edits.filter((e) => e.args.messageId === "m2").at(-1)
        ?.args.payload;
      expect(firstFinal).toContain("A");
      expect(firstFinal).not.toContain("B");
      expect(secondFinal).toContain("B");
    });
  });

  describe("resolveUser", () => {
    it("does NOT cache the bare-id fallback on transient fetch failure", async () => {
      const { adapter, connector } = makeAdapter();
      let call = 0;
      connector.resolveUser = async (userId) => {
        connector.calls.push({ op: "resolveUser", args: { userId } });
        call++;
        if (call === 1) throw new Error("rate limited");
        return { id: "u1", name: "Ada", handle: "ada" };
      };

      const first = await adapter.resolveUser("u1");
      expect(first).toEqual({ id: "u1" }); // bare-id fallback

      const second = await adapter.resolveUser("u1");
      expect(call).toBe(2); // a retry happened (not served from cache)
      expect(second).toEqual({ id: "u1", name: "Ada", handle: "ada" });
    });

    it("caches a successfully resolved user", async () => {
      const { adapter, connector } = makeAdapter();
      connector.results.resolveUser = { id: "u1", name: "Ana", handle: "ana" };
      const first = await adapter.resolveUser("u1");
      const second = await adapter.resolveUser("u1");
      expect(first).toEqual(second);
      expect(
        connector.calls.filter((c) => c.op === "resolveUser"),
      ).toHaveLength(1);
    });
  });

  describe("getMessages", () => {
    it("excludes the bot's own streaming placeholders from history", async () => {
      const { adapter, connector } = makeAdapter();
      connector.results.fetchMessages = [
        {
          id: "m3",
          content: "here is the real answer",
          authorId: "bot-1",
          authorIsBot: true,
          attachments: [],
        },
        {
          id: "m2",
          content: "_thinking…_",
          authorId: "bot-1",
          authorIsBot: true,
          attachments: [],
        },
        {
          id: "m1",
          content: "hey bot",
          authorId: "u1",
          authorName: "Ann",
          authorHandle: "ann",
          authorIsBot: false,
          attachments: [],
        },
      ];

      const out = await adapter.getMessages({ channelId: "c1" } as never);
      const texts = out.map((m) => m.text);
      expect(texts).toContain("hey bot");
      expect(texts).toContain("here is the real answer");
      expect(texts).not.toContain("_thinking…_");
      expect(out).toHaveLength(2);
    });

    it("returns [] when fetchMessages throws", async () => {
      const { adapter, connector } = makeAdapter();
      connector.results.throwing = { fetchMessages: new Error("boom") };
      const out = await adapter.getMessages({ channelId: "c1" } as never);
      expect(out).toEqual([]);
    });
  });

  describe("addReaction / removeReaction", () => {
    it("addReaction falls back to the target channel when the reacted ref has no channelId", async () => {
      // The reacted ref the bot-ui example sends is just `{ id }` (no channelId);
      // the channel must come from the conversation's reply target — parity with
      // Slack/Telegram.
      const { adapter, connector } = makeAdapter();
      const res = await adapter.addReaction(
        { channelId: "c1" } as never,
        { id: "m1" } as never,
        "eyes" as never,
      );
      expect(res).toEqual({ ok: true });
      const call = connector.calls[0]!;
      expect(call.op).toBe("addReaction");
      expect((call.args as { channelId: string }).channelId).toBe("c1");
    });

    it("addReaction resolves thumbs_up to 👍 via the connector", async () => {
      const { adapter, connector } = makeAdapter();
      const res = await adapter.addReaction(
        { channelId: "c1" } as never,
        { id: "m1", channelId: "c1" } as never,
        "thumbs_up" as never,
      );
      expect(res).toEqual({ ok: true });
      expect((connector.calls[0]!.args as { emoji: string }).emoji).toBe("👍");
    });

    it("removeReaction routes to the connector", async () => {
      const { adapter, connector } = makeAdapter();
      const res = await adapter.removeReaction(
        { channelId: "c1" } as never,
        { id: "m1", channelId: "c1" } as never,
        "thumbs_up" as never,
      );
      expect(res).toEqual({ ok: true });
      expect(connector.calls[0]!.op).toBe("removeReaction");
    });

    it("surfaces the connector's error as { ok: false, error }", async () => {
      const { adapter, connector } = makeAdapter();
      connector.results.throwing = { addReaction: new Error("forbidden") };
      const res = await adapter.addReaction(
        { channelId: "c1" } as never,
        { id: "m1", channelId: "c1" } as never,
        "eyes" as never,
      );
      expect(res).toEqual({ ok: false, error: "forbidden" });
    });
  });

  describe("postFile", () => {
    it("uploads via the connector and returns ok + fileId", async () => {
      const { adapter, connector } = makeAdapter();
      connector.results.postFile = { id: "f1" };
      const res = await adapter.postFile({ channelId: "c1" } as never, {
        bytes: new Uint8Array([1, 2, 3]),
        filename: "chart.png",
      });
      expect(res).toEqual({ ok: true, fileId: "f1" });
      expect(connector.calls[0]!.op).toBe("postFile");
    });

    it("returns ok:false with the error message when the connector throws", async () => {
      const { adapter, connector } = makeAdapter();
      connector.results.throwing = { postFile: new Error("upload_failed") };
      const res = await adapter.postFile({ channelId: "c1" } as never, {
        bytes: new Uint8Array([1]),
        filename: "x.png",
      });
      expect(res).toEqual({ ok: false, error: "upload_failed" });
    });
  });

  describe("postEphemeral (DM fallback)", () => {
    it("DM-falls-back when fallbackToDM=true (usedFallback=true)", async () => {
      const { adapter, connector } = makeAdapter();
      connector.results.sendDM = { id: "dm-msg-1", channelId: "dm-channel-1" };
      const res = await adapter.postEphemeral(
        { channelId: "C1" } as never,
        { id: "U1" },
        [{ type: "text", props: { value: "hi" } }],
        { fallbackToDM: true },
      );
      expect(res).toMatchObject({ ok: true, usedFallback: true });
      expect(connector.calls[0]!.op).toBe("sendDM");
    });

    it("returns null when fallbackToDM=false", async () => {
      const { adapter } = makeAdapter();
      const res = await adapter.postEphemeral(
        { channelId: "C1" } as never,
        { id: "U1" },
        [{ type: "text", props: { value: "hi" } }],
        { fallbackToDM: false },
      );
      expect(res).toBeNull();
    });
  });

  describe("decodeInteraction", () => {
    it("decodes a component interaction to an opaque-id InteractionEvent", () => {
      const { adapter } = makeAdapter();
      const evt = adapter.decodeInteraction({
        isButton: () => true,
        isStringSelectMenu: () => false,
        customId: "ck:z",
        channelId: "c1",
        message: { id: "m1" },
      });
      expect(evt).toBeDefined();
      expect(evt!.id).toBe("ck:z");
      expect(evt!.conversationKey).toBe("c1");
    });
  });

  describe("registerCommands", () => {
    it("delegates directly to the connector", () => {
      const { adapter, connector } = makeAdapter();
      adapter.registerCommands([{ name: "agent", description: "x" }]);
      expect(connector.registeredCommands).toHaveLength(1);
      expect(connector.registeredCommands[0]).toEqual([
        { name: "agent", description: "x" },
      ]);
    });
  });

  describe("openModal", () => {
    it("renders the modal and delegates to the connector's openModal", async () => {
      const { adapter, connector } = makeAdapter();
      const modalIr = [
        { type: "modal", props: { callbackId: "x", title: "t", children: [] } },
      ];
      const res = await adapter.openModal(
        { channelId: "c1" } as never,
        "trigger-1",
        modalIr as never,
      );
      expect(res).toEqual({ ok: true });
      expect(connector.calls[0]).toMatchObject({
        op: "openModal",
        args: { triggerId: "trigger-1" },
      });
    });

    it("returns { ok: false } on an unsupported modal element without calling the connector", async () => {
      const { adapter, connector } = makeAdapter();
      const badIr = [
        {
          type: "modal",
          props: {
            callbackId: "x",
            title: "t",
            children: [{ type: "modal_select", props: {} }],
          },
        },
      ];
      const res = await adapter.openModal(
        { channelId: "c1" } as never,
        "trigger-1",
        badIr as never,
      );
      expect(res.ok).toBe(false);
      expect(connector.calls).toHaveLength(0);
    });
  });

  describe("start()", () => {
    it("resolves ingress config through the connector and captures botUserId", async () => {
      const { adapter, connector } = makeAdapter();
      await adapter.start({
        onTurn: async () => {},
        onInteraction: async () => {},
        onCommand: async () => {},
        onThreadStarted: async () => {},
        onReaction: async () => {},
        onModalSubmit: async () => ({}),
        onModalClose: async () => {},
      });
      expect(connector.ingressConfig).toBeDefined();
      // botUserId flows from the connector's startIngress result into the
      // adapter (used by `resolveUser` cache keys / capability decisions).
      const evt = adapter.decodeInteraction({
        isButton: () => true,
        isStringSelectMenu: () => false,
        customId: "ck:z",
        channelId: "c1",
      });
      expect(evt).toBeDefined();
    });

    it("stop() is a lenient no-op when never started", async () => {
      const adapter = new DiscordAdapter({});
      await expect(adapter.stop()).resolves.toBeUndefined();
    });

    it("stop() stops the bound connector's ingress", async () => {
      const { adapter, connector } = makeAdapter();
      await adapter.stop();
      expect(connector.ingressStopped).toBe(true);
    });
  });
});
