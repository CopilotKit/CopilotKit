import { describe, it, expect } from "vitest";
import { TelegramAdapter } from "./adapter.js";
import { FakeTelegramConnector } from "./testing/fake-telegram-connector.js";
import type { ChannelNode } from "@copilotkit/channels-ui";

/**
 * `TelegramAdapter.makeEgress(connector)` is a SECOND entry point onto the
 * SAME effect→native mapping the `PlatformAdapter` methods use — routed
 * through a RUNNER-supplied connector instead of the adapter's own bound one.
 * Every test here injects a connector distinct from the adapter's own bound
 * connector (via `ɵbindConnector`) and asserts calls land ONLY on the
 * injected one.
 */
function makeAdapter() {
  const adapter = new TelegramAdapter({});
  // The adapter's OWN bound connector — must receive ZERO calls when driving
  // effects through `makeEgress`'s injected connector instead.
  const ownConnector = new FakeTelegramConnector();
  adapter.ɵbindConnector(ownConnector);
  const injected = new FakeTelegramConnector();
  return { adapter, ownConnector, injected };
}

const section = (text: string): ChannelNode => ({
  type: "section",
  props: { children: [{ type: "text", props: { value: text } }] },
});

describe("TelegramAdapter.makeEgress", () => {
  it("send({op:'post'}) routes to the injected connector's sendMessage, not the adapter's own", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const ref = await egress.send({
      op: "post",
      target: { chatId: 9 },
      ir: [section("hi")],
    });

    expect(injected.calls).toHaveLength(1);
    expect(injected.calls[0]!.op).toBe("sendMessage");
    expect(ownConnector.calls).toHaveLength(0);
    expect(ref.chatId).toBe(9);
  });

  it("send({op:'update'}) routes to the injected connector's editMessageText", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const ref = await egress.send({
      op: "update",
      ref: { id: "9:11", chatId: 9, messageId: 11 },
      ir: [section("edited")],
    });

    expect(injected.calls[0]!.op).toBe("editMessageText");
    expect(ownConnector.calls).toHaveLength(0);
    expect(ref).toEqual({ id: "9:11", chatId: 9, messageId: 11 });
  });

  it("send({op:'delete'}) routes to the injected connector's deleteMessage", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    await egress.send({
      op: "delete",
      ref: { id: "9:11", chatId: 9, messageId: 11 },
    });

    expect(injected.calls[0]!.op).toBe("deleteMessage");
    expect(injected.calls[0]!.args).toEqual({ chatId: 9, messageId: 11 });
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'react', add:true}) routes to the injected connector's setMessageReaction", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "react",
      target: { chatId: 9 },
      ref: { id: "9:11", chatId: 9, messageId: 11 },
      emoji: "thumbsup",
      add: true,
    });

    expect(res).toEqual({ ok: true });
    expect(injected.calls[0]!.op).toBe("setMessageReaction");
    const args = injected.calls[0]!.args as { reactions: unknown[] };
    expect(args.reactions).toHaveLength(1);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'react', add:false}) routes to the injected connector's setMessageReaction with an empty list", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "react",
      target: { chatId: 9 },
      ref: { id: "9:11", chatId: 9, messageId: 11 },
      emoji: "thumbsup",
      add: false,
    });

    expect(res).toEqual({ ok: true });
    expect(injected.calls[0]!.op).toBe("setMessageReaction");
    const args = injected.calls[0]!.args as { reactions: unknown[] };
    expect(args.reactions).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'react'}) surfaces the injected connector's error as {ok:false, error}", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    injected.results.throwing = {
      setMessageReaction: new Error("rate limited"),
    };
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "react",
      target: { chatId: 9 },
      ref: { id: "9:11", chatId: 9, messageId: 11 },
      emoji: "thumbsup",
      add: true,
    });

    expect(res).toEqual({ ok: false, error: "rate limited" });
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'ephemeral', fallbackToDM:true}) routes to the injected connector's sendMessage", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "ephemeral",
      target: { chatId: 9 },
      user: "U1",
      ir: [section("shh")],
      fallbackToDM: true,
    });

    expect(injected.calls[0]!.op).toBe("sendMessage");
    expect(ownConnector.calls).toHaveLength(0);
    expect(res?.ok).toBe(true);
  });

  it("send({op:'ephemeral', fallbackToDM:false}) touches neither connector (no native ephemeral on Telegram)", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "ephemeral",
      target: { chatId: 9 },
      user: "U1",
      ir: [section("shh")],
      fallbackToDM: false,
    });

    expect(res).toBeNull();
    expect(injected.calls).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'file'}) routes to the injected connector's sendDocument", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "file",
      target: { chatId: 9 },
      file: { bytes: new Uint8Array([1, 2, 3]), filename: "x.png" },
    });

    expect(res.ok).toBe(true);
    expect(injected.calls[0]!.op).toBe("sendDocument");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'suggested'}) returns {ok:false} without touching either connector (unsupported)", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "suggested",
      target: { chatId: 9 },
      prompts: [{ title: "T", message: "M" }],
    });

    expect(res.ok).toBe(false);
    expect(injected.calls).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'title'}) routes to the injected connector's editForumTopic for a forum-topic target", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "title",
      target: { chatId: 9, messageThreadId: 42 },
      title: "New title",
    });

    expect(res).toEqual({ ok: true });
    expect(injected.calls[0]!.op).toBe("editForumTopic");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("stream() drives the injected connector's sendMessage/editMessageText", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);
    async function* chunks() {
      yield "Hello";
      yield " world";
    }

    const ref = await egress.stream({ chatId: 9 }, chunks());

    const ops = injected.calls.map((c) => c.op);
    expect(ops[0]).toBe("sendMessage");
    expect(ops.slice(1)).toContain("editMessageText");
    expect(ref.chatId).toBe(9);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("createRunRenderer() projects the transport onto the injected connector", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);
    const renderer = egress.createRunRenderer({ chatId: 9 });

    await renderer.subscriber.onTextMessageStartEvent!({
      event: { messageId: "m1" },
    } as never);
    renderer.subscriber.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "hi" },
    } as never);
    await renderer.subscriber.onTextMessageEndEvent!({
      event: { messageId: "m1" },
    } as never);
    await renderer.subscriber.onRunFinishedEvent!({ event: {} } as never);

    const ops = injected.calls.map((c) => c.op);
    expect(ops).toContain("sendMessage");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("getMessages() reads from the adapter's own (credential-free) store regardless of the injected connector", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);
    await egress.send({
      op: "post",
      target: { chatId: 9, conversationKey: "tg:9:dm" },
      ir: [section("hi")],
    });

    const msgs = await egress.getMessages!({
      chatId: 9,
      conversationKey: "tg:9:dm",
    });

    expect(msgs).toHaveLength(1);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("lookupUser() routes to the injected connector's getChat", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    injected.results.getChat = { id: 5, username: "ana", title: "Ana Smith" };
    const egress = adapter.makeEgress(injected);

    const u = await egress.lookupUser!({ query: "@ana" });

    expect(injected.calls[0]!.op).toBe("getChat");
    expect(u?.name).toBe("Ana Smith");
    expect(ownConnector.calls).toHaveLength(0);
  });
});
