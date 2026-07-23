import { describe, it, expect } from "vitest";
import { whatsapp } from "./adapter.js";
import { FakeWhatsAppConnector } from "./testing/fake-whatsapp-connector.js";
import type { ChannelNode } from "@copilotkit/channels-ui";

/**
 * `WhatsAppAdapter.makeEgress(connector)` is a SECOND entry point onto the
 * SAME effect→native mapping the `PlatformAdapter` methods use — routed
 * through a RUNNER-supplied connector instead of the adapter's own bound one.
 * Every test here injects a connector distinct from the adapter's own bound
 * connector (via `ɵbindConnector`) and asserts calls land ONLY on the
 * injected one.
 */
function makeAdapter() {
  const adapter = whatsapp({});
  // The adapter's OWN bound connector — must receive ZERO calls when driving
  // effects through `makeEgress`'s injected connector instead.
  const ownConnector = new FakeWhatsAppConnector();
  adapter.ɵbindConnector(ownConnector);
  const injected = new FakeWhatsAppConnector();
  return { adapter, ownConnector, injected };
}

const section = (text: string): ChannelNode => ({
  type: "section",
  props: { children: [{ type: "text", props: { value: text } }] },
});

describe("WhatsAppAdapter.makeEgress", () => {
  it("send({op:'post'}) routes to the injected connector's sendMessage, not the adapter's own", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const ref = await egress.send({
      op: "post",
      target: { to: "111", phoneNumberId: "PNID" },
      ir: [section("hi")],
    });

    expect(injected.calls).toHaveLength(1);
    expect(injected.calls[0]!.op).toBe("sendMessage");
    expect(ownConnector.calls).toHaveLength(0);
    expect(ref.id).toBe("fake-wamid-1");
  });

  it("send({op:'update'}) posts a fresh message via the injected connector (WhatsApp can't edit)", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    await egress.send({
      op: "update",
      ref: { id: "wamid.old", to: "111", phoneNumberId: "PNID" } as never,
      ir: [section("edited")],
    });

    expect(injected.calls[0]!.op).toBe("sendMessage");
    expect(injected.calls[0]).toMatchObject({ args: { to: "111" } });
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'delete'}) is a no-op on both connectors (no delete API)", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    await egress.send({
      op: "delete",
      ref: { id: "wamid.old", to: "111", phoneNumberId: "PNID" } as never,
    });

    expect(injected.calls).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'file'}) routes to the injected connector's uploadMedia + sendMessage", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "file",
      target: { to: "111", phoneNumberId: "PNID" },
      file: { bytes: new Uint8Array([1, 2, 3]), filename: "x.png" },
    });

    expect(res).toEqual({ ok: true, fileId: "fake-media-1" });
    expect(injected.calls.map((c) => c.op)).toEqual([
      "uploadMedia",
      "sendMessage",
    ]);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'react'}) resolves unsupported without touching either connector", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "react",
      target: { to: "111", phoneNumberId: "PNID" },
      ref: { id: "wamid.1" },
      emoji: "thumbsup",
      add: true,
    });

    expect(res.ok).toBe(false);
    expect(injected.calls).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'ephemeral'}) resolves unsupported without touching either connector", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "ephemeral",
      target: { to: "111", phoneNumberId: "PNID" },
      user: "111",
      ir: [section("shh")],
      fallbackToDM: false,
    });

    expect(res?.ok).toBe(false);
    expect(injected.calls).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'suggested'}) resolves unsupported without touching either connector", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "suggested",
      target: { to: "111", phoneNumberId: "PNID" },
      prompts: [{ title: "T", message: "M" }],
    });

    expect(res.ok).toBe(false);
    expect(injected.calls).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'title'}) resolves unsupported without touching either connector", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "title",
      target: { to: "111", phoneNumberId: "PNID" },
      title: "New title",
    });

    expect(res.ok).toBe(false);
    expect(injected.calls).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("stream() buffers the iterable, then drives the injected connector's sendMessage once", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);
    async function* chunks() {
      yield "Hello";
      yield " world";
    }

    const ref = await egress.stream(
      { to: "111", phoneNumberId: "PNID" },
      chunks(),
    );

    expect(injected.calls).toHaveLength(1);
    expect(injected.calls[0]!.op).toBe("sendMessage");
    expect(ref.id).toBe("fake-wamid-1");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("createRunRenderer() drives the injected connector's sendMessage on text end", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);
    const renderer = egress.createRunRenderer({
      to: "111",
      phoneNumberId: "PNID",
    });

    renderer.subscriber.onTextMessageStartEvent!({
      event: { messageId: "m1" },
    } as never);
    renderer.subscriber.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "hi" },
    } as never);
    await renderer.subscriber.onTextMessageEndEvent!({
      event: { messageId: "m1" },
    } as never);

    expect(injected.calls[0]!.op).toBe("sendMessage");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("getMessages() reads from the adapter's history store regardless of connector (no token involved)", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const msgs = await egress.getMessages!({
      to: "111",
      phoneNumberId: "PNID",
    });

    expect(msgs).toEqual([]);
    expect(injected.calls).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("lookupUser() resolves undefined (no user directory) without touching either connector", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const u = await egress.lookupUser!({ query: "anyone" });

    expect(u).toBeUndefined();
    expect(injected.calls).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });
});
