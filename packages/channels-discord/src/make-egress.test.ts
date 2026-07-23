import { describe, it, expect } from "vitest";
import { DiscordAdapter } from "./adapter.js";
import { FakeDiscordConnector } from "./testing/fake-discord-connector.js";
import type { ChannelNode } from "@copilotkit/channels-ui";

/**
 * `DiscordAdapter.makeEgress(connector)` is a SECOND entry point onto the SAME
 * effect→native mapping the `PlatformAdapter` methods use — routed through a
 * RUNNER-supplied connector instead of the adapter's own bound one. Every test
 * here injects a connector distinct from the adapter's own bound connector
 * (via `ɵbindConnector`) and asserts calls land ONLY on the injected one.
 * Mirrors `channels-slack/src/make-egress.test.ts`.
 */
function makeAdapter() {
  const adapter = new DiscordAdapter({});
  const ownConnector = new FakeDiscordConnector();
  adapter.ɵbindConnector(ownConnector);
  const injected = new FakeDiscordConnector();
  return { adapter, ownConnector, injected };
}

const section = (text: string): ChannelNode => ({
  type: "message",
  props: { children: [{ type: "text", props: { value: text } }] },
});

describe("DiscordAdapter.makeEgress", () => {
  it("send({op:'post'}) routes to the injected connector's sendMessage, not the adapter's own", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    injected.results.sendMessage = { id: "m1" };
    const egress = adapter.makeEgress(injected);

    const ref = await egress.send({
      op: "post",
      target: { channelId: "c1" },
      ir: [section("hi")],
    });

    expect(injected.calls).toHaveLength(1);
    expect(injected.calls[0]!.op).toBe("sendMessage");
    expect(ownConnector.calls).toHaveLength(0);
    expect(ref).toEqual({ id: "m1", channelId: "c1" });
  });

  it("send({op:'update'}) routes to the injected connector's editMessage", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const ref = await egress.send({
      op: "update",
      ref: { id: "m1", channelId: "c1" },
      ir: [section("edited")],
    });

    expect(injected.calls[0]!.op).toBe("editMessage");
    expect(ownConnector.calls).toHaveLength(0);
    expect(ref).toEqual({ id: "m1", channelId: "c1" });
  });

  it("send({op:'delete'}) routes to the injected connector's deleteMessage", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    await egress.send({ op: "delete", ref: { id: "m1", channelId: "c1" } });

    expect(injected.calls[0]).toEqual({
      op: "deleteMessage",
      args: { channelId: "c1", messageId: "m1" },
    });
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'react', add:true}) routes to the injected connector's addReaction", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "react",
      target: { channelId: "c1" },
      ref: { id: "m1", channelId: "c1" },
      emoji: "thumbsup",
      add: true,
    });

    expect(res).toEqual({ ok: true });
    expect(injected.calls[0]!.op).toBe("addReaction");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'react', add:false}) routes to the injected connector's removeReaction", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "react",
      target: { channelId: "c1" },
      ref: { id: "m1", channelId: "c1" },
      emoji: "thumbsup",
      add: false,
    });

    expect(res).toEqual({ ok: true });
    expect(injected.calls[0]!.op).toBe("removeReaction");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'react'}) surfaces the injected connector's error as {ok:false, error}", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    injected.results.throwing = { addReaction: new Error("forbidden") };
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "react",
      target: { channelId: "c1" },
      ref: { id: "m1", channelId: "c1" },
      emoji: "thumbsup",
      add: true,
    });

    expect(res).toEqual({ ok: false, error: "forbidden" });
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'ephemeral'}) routes to the injected connector's sendDM (fallbackToDM)", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    injected.results.sendDM = { id: "dm1", channelId: "dmc1" };
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "ephemeral",
      target: { channelId: "c1" },
      user: "u1",
      ir: [section("shh")],
      fallbackToDM: true,
    });

    expect(injected.calls[0]!.op).toBe("sendDM");
    expect(ownConnector.calls).toHaveLength(0);
    expect(res?.ok).toBe(true);
  });

  it("send({op:'ephemeral', fallbackToDM:false}) returns null without touching either connector", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "ephemeral",
      target: { channelId: "c1" },
      user: "u1",
      ir: [section("shh")],
      fallbackToDM: false,
    });

    expect(res).toBeNull();
    expect(injected.calls).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'file'}) routes to the injected connector's postFile", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    injected.results.postFile = { id: "f1" };
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "file",
      target: { channelId: "c1" },
      file: { bytes: new Uint8Array([1, 2, 3]), filename: "x.png" },
    });

    expect(res).toEqual({ ok: true, fileId: "f1" });
    expect(injected.calls[0]!.op).toBe("postFile");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'suggested'}) degrades to {ok:false} — Discord has no assistant-pane equivalent", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "suggested",
      target: { channelId: "c1" },
      prompts: [{ title: "T", message: "M" }],
    });

    expect(res.ok).toBe(false);
    expect(injected.calls).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'title'}) degrades to {ok:false} — Discord has no thread-title equivalent", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "title",
      target: { channelId: "c1" },
      title: "New title",
    });

    expect(res.ok).toBe(false);
    expect(injected.calls).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("stream() drives the injected connector's sendMessage/editMessage", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);
    async function* chunks() {
      yield "Hello";
      yield " world";
    }

    const ref = await egress.stream({ channelId: "c1" }, chunks());

    const ops = injected.calls.map((c) => c.op);
    expect(ops[0]).toBe("sendMessage");
    expect(ops).toContain("editMessage");
    expect(ref.channelId).toBe("c1");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("createRunRenderer() projects the transport onto the injected connector", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);
    const renderer = egress.createRunRenderer({ channelId: "c1" });

    await renderer.subscriber.onTextMessageStartEvent!({
      event: { messageId: "m1" },
    } as never);
    renderer.subscriber.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "hi" },
    } as never);
    await renderer.subscriber.onTextMessageEndEvent!({
      event: { messageId: "m1" },
    } as never);

    const ops = injected.calls.map((c) => c.op);
    expect(ops).toContain("sendMessage");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("getMessages() routes reads to the injected connector", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    injected.results.fetchMessages = [
      { id: "m1", content: "hi", authorId: "u1", attachments: [] },
    ];
    const egress = adapter.makeEgress(injected);

    const msgs = await egress.getMessages!({ channelId: "c1" });

    expect(injected.calls[0]!.op).toBe("fetchMessages");
    expect(msgs).toHaveLength(1);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("lookupUser() routes to the injected connector's lookupUser", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    injected.results.lookupUser = { id: "u1", name: "Ana" };
    const egress = adapter.makeEgress(injected);

    const u = await egress.lookupUser!({ query: "ana" });

    expect(injected.calls[0]!.op).toBe("lookupUser");
    expect(u?.name).toBe("Ana");
    expect(ownConnector.calls).toHaveLength(0);
  });
});
