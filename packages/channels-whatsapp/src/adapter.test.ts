import { describe, it, expect, vi } from "vitest";
import { whatsapp, splitForWhatsApp } from "./adapter.js";
import { InMemoryHistoryStore } from "./history-store.js";

describe("whatsapp() adapter", () => {
  const opts = {
    accessToken: "TOK",
    phoneNumberId: "PNID",
    appSecret: "SECRET",
    verifyToken: "VTOK",
  };

  it("declares the platform and capabilities (no streaming)", () => {
    const a = whatsapp(opts);
    expect(a.platform).toBe("whatsapp");
    expect(a.capabilities.supportsStreaming).toBe(false);
    expect(a.capabilities.supportsModals).toBe(false);
    expect(a.conversationStore).toBeDefined();
  });

  it("render() lowers IR to Cloud API payloads", () => {
    const a = whatsapp(opts);
    const payloads = a.render([
      { type: "section", props: { children: "hi" } },
    ]) as any[];
    expect(payloads[0]).toMatchObject({ type: "text" });
  });

  it("post() sends each rendered payload via the client and returns a ref", async () => {
    const a = whatsapp(opts) as any;
    const sent: any[] = [];
    a.client = {
      sendMessage: vi.fn(async (to: string, p: any) => {
        sent.push({ to, p });
        return { id: "wamid.X", to, phoneNumberId: "PNID" };
      }),
    };
    const ref = await a.post({ to: "111", phoneNumberId: "PNID" }, [
      { type: "section", props: { children: "hi" } },
    ]);
    expect(sent[0].to).toBe("111");
    expect(ref).toMatchObject({ id: "wamid.X" });
  });

  it("records outbound messages in history keyed by wamid (quote-reply resolution)", async () => {
    const history = new InMemoryHistoryStore();
    const a = whatsapp({ ...opts, historyStore: history }) as any;
    a.client = {
      sendMessage: vi.fn(async (to: string) => ({
        id: "wamid.OUT1",
        to,
        phoneNumberId: "PNID",
      })),
    };
    await a.post({ to: "111", phoneNumberId: "PNID" }, [
      { type: "section", props: { children: "Open CPK issues" } },
    ]);
    const hist = await history.read("whatsapp:111");
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ role: "assistant", id: "wamid.OUT1" });
    expect(hist[0]!.content).toContain("Open CPK issues");
  });

  it("decodeInteraction delegates to the interaction decoder", () => {
    const a = whatsapp(opts);
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
    const a = whatsapp(opts);
    expect(await a.lookupUser({ query: "anyone" })).toBeUndefined();
  });

  it("postFile uploads media and sends an image payload by id for image mimes", async () => {
    const a = whatsapp(opts) as any;
    const calls: any[] = [];
    a.client = {
      uploadMedia: vi.fn(async () => "MEDIA1"),
      sendMessage: vi.fn(async (to: string, p: any) => {
        calls.push(p);
        return { id: "x", to, phoneNumberId: "PNID" };
      }),
    };
    const res = await a.postFile(
      { to: "111", phoneNumberId: "PNID" },
      { bytes: new Uint8Array([1]), filename: "pic.png", altText: "a pic" },
    );
    expect(res).toEqual({ ok: true, fileId: "MEDIA1" });
    expect(calls[0]).toEqual({
      type: "image",
      image: { id: "MEDIA1", caption: "a pic" },
    });
  });

  it("postFile sends a document payload by id for non-image mimes", async () => {
    const a = whatsapp(opts) as any;
    const calls: any[] = [];
    a.client = {
      uploadMedia: vi.fn(async () => "M2"),
      sendMessage: vi.fn(async (to: string, p: any) => {
        calls.push(p);
        return { id: "x", to, phoneNumberId: "PNID" };
      }),
    };
    await a.postFile(
      { to: "111", phoneNumberId: "PNID" },
      { bytes: new Uint8Array([1]), filename: "report.pdf", title: "Report" },
    );
    expect(calls[0]).toEqual({
      type: "document",
      document: { id: "M2", filename: "report.pdf", caption: "Report" },
    });
  });

  it("buffered run renderer send converts markdown before sending", async () => {
    const a = whatsapp(opts) as any;
    const sent: string[] = [];
    a.client = {
      sendMessage: vi.fn(async (to: string, p: any) => {
        sent.push(p.text.body);
        return { id: "x", to, phoneNumberId: "PNID" };
      }),
    };
    const r = a.createRunRenderer({ to: "111", phoneNumberId: "PNID" });
    const s = r.subscriber;
    s.onTextMessageStartEvent({ event: { messageId: "m" } });
    s.onTextMessageContentEvent({
      event: { messageId: "m", delta: "**hi** world" },
    });
    await s.onTextMessageEndEvent({ event: { messageId: "m" } });
    expect(sent).toEqual(["*hi* world"]);
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
