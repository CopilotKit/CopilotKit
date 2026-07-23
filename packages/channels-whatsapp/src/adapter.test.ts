import { describe, it, expect } from "vitest";
import { whatsapp, splitForWhatsApp } from "./adapter.js";
import { InMemoryHistoryStore } from "./history-store.js";
import { FakeWhatsAppConnector } from "./testing/fake-whatsapp-connector.js";

/** A credential-free adapter with a bound `FakeWhatsAppConnector`. */
function makeAdapter(opts: Parameters<typeof whatsapp>[0] = {}) {
  const adapter = whatsapp(opts);
  const connector = new FakeWhatsAppConnector();
  adapter.ɵbindConnector(connector);
  return { adapter, connector };
}

describe("whatsapp() adapter", () => {
  it("declares the platform and capabilities (no streaming)", () => {
    const a = whatsapp({});
    expect(a.platform).toBe("whatsapp");
    expect(a.capabilities.supportsStreaming).toBe(false);
    expect(a.capabilities.supportsModals).toBe(false);
    expect(a.conversationStore).toBeDefined();
  });

  it("egress methods throw a clear error when unbound (no connector injected)", async () => {
    const a = whatsapp({});
    await expect(
      a.post({ to: "111", phoneNumberId: "PNID" }, []),
    ).rejects.toThrow(/no connector/i);
  });

  it("render() lowers IR to Cloud API payloads", () => {
    const a = whatsapp({});
    const payloads = a.render([
      { type: "section", props: { children: "hi" } },
    ]) as any[];
    expect(payloads[0]).toMatchObject({ type: "text" });
  });

  it("post() sends each rendered payload via the bound connector and returns a ref", async () => {
    const { adapter, connector } = makeAdapter();
    const ref = await adapter.post({ to: "111", phoneNumberId: "PNID" }, [
      { type: "section", props: { children: "hi" } },
    ]);
    expect(connector.calls).toHaveLength(1);
    expect(connector.calls[0]).toMatchObject({
      op: "sendMessage",
      args: { to: "111" },
    });
    expect(ref.id).toBe("fake-wamid-1");
  });

  it("records outbound messages in history keyed by wamid (quote-reply resolution)", async () => {
    const history = new InMemoryHistoryStore();
    const { adapter } = makeAdapter({ historyStore: history });
    await adapter.post({ to: "111", phoneNumberId: "PNID" }, [
      { type: "section", props: { children: "Open CPK issues" } },
    ]);
    const hist = await history.read("whatsapp:111");
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ role: "assistant", id: "fake-wamid-1" });
    expect(hist[0]!.content).toContain("Open CPK issues");
  });

  it("decodeInteraction delegates to the interaction decoder", () => {
    const a = whatsapp({});
    const evt = a.decodeInteraction({
      message: {
        from: "111",
        id: "wamid.1",
        type: "interactive",
        interactive: {
          type: "button_reply",
          button_reply: { id: "ck:9", title: "Y" },
        },
      },
      replyTarget: { to: "111", phoneNumberId: "PNID" },
    });
    expect(evt?.id).toBe("ck:9");
  });

  it("lookupUser returns undefined (no directory)", async () => {
    const a = whatsapp({});
    expect(await a.lookupUser({ query: "anyone" })).toBeUndefined();
  });

  it("postFile uploads media and sends an image payload by id for image mimes", async () => {
    const { adapter, connector } = makeAdapter();
    const res = await adapter.postFile(
      { to: "111", phoneNumberId: "PNID" },
      { bytes: new Uint8Array([1]), filename: "pic.png", altText: "a pic" },
    );
    expect(res).toEqual({ ok: true, fileId: "fake-media-1" });
    const send = connector.calls.find((c) => c.op === "sendMessage");
    expect(send?.args).toMatchObject({
      payload: {
        type: "image",
        image: { id: "fake-media-1", caption: "a pic" },
      },
    });
  });

  it("postFile sends a document payload by id for non-image mimes", async () => {
    const { adapter, connector } = makeAdapter();
    await adapter.postFile(
      { to: "111", phoneNumberId: "PNID" },
      { bytes: new Uint8Array([1]), filename: "report.pdf", title: "Report" },
    );
    const send = connector.calls.find((c) => c.op === "sendMessage");
    expect(send?.args).toMatchObject({
      payload: {
        type: "document",
        document: {
          id: "fake-media-1",
          filename: "report.pdf",
          caption: "Report",
        },
      },
    });
  });

  it("buffered run renderer send converts markdown before sending", async () => {
    const { adapter, connector } = makeAdapter();
    const r = adapter.createRunRenderer({ to: "111", phoneNumberId: "PNID" });
    const s = r.subscriber;
    (s.onTextMessageStartEvent as any)({ event: { messageId: "m" } });
    (s.onTextMessageContentEvent as any)({
      event: { messageId: "m", delta: "**hi** world" },
    });
    await (s.onTextMessageEndEvent as any)({ event: { messageId: "m" } });
    const send = connector.calls.find((c) => c.op === "sendMessage");
    expect((send as any)?.args.payload.text.body).toBe("*hi* world");
  });
});

describe("splitForWhatsApp", () => {
  it("returns one chunk when under the limit", () => {
    expect(splitForWhatsApp("abc", 10)).toEqual(["abc"]);
  });
  it("splits text over the limit into max-sized chunks", () => {
    expect(splitForWhatsApp("abcdef", 3)).toEqual(["abc", "def"]);
  });
});
