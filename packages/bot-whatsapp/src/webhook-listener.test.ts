import { describe, it, expect, vi } from "vitest";
import { handleWebhookValue } from "./webhook-listener.js";
import { InMemoryHistoryStore } from "./history-store.js";
import type { ChangeValue } from "./types.js";

function makeSink() {
  return {
    onTurn: vi.fn(),
    onInteraction: vi.fn(),
    onCommand: vi.fn(),
  };
}

const baseArgs = (sink: any, history = new InMemoryHistoryStore()) => ({
  sink,
  history,
  phoneNumberId: "PNID",
  commandPrefix: "/",
  client: {
    downloadMedia: async () => ({ bytes: new Uint8Array(), mimeType: "x" }),
  } as any,
  files: {},
});

describe("handleWebhookValue", () => {
  it("emits a turn for an inbound text message and stores it", async () => {
    const sink = makeSink();
    const history = new InMemoryHistoryStore();
    const value: ChangeValue = {
      contacts: [{ wa_id: "111", profile: { name: "Ada" } }],
      messages: [
        { from: "111", id: "wamid.1", type: "text", text: { body: "hello" } },
      ],
    };
    await handleWebhookValue(value, baseArgs(sink, history));
    expect(sink.onTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: "whatsapp:111",
        userText: "hello",
        platform: "whatsapp",
        user: { id: "111", name: "Ada" },
        replyTarget: { to: "111", phoneNumberId: "PNID" },
      }),
    );
    expect(await history.read("whatsapp:111")).toHaveLength(1);
  });

  it("emits a command for a text starting with the prefix", async () => {
    const sink = makeSink();
    const history = new InMemoryHistoryStore();
    const value: ChangeValue = {
      messages: [
        {
          from: "111",
          id: "wamid.2",
          type: "text",
          text: { body: "/triage urgent bug" },
        },
      ],
    };
    await handleWebhookValue(value, baseArgs(sink, history));
    expect(sink.onCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "triage",
        text: "urgent bug",
        conversationKey: "whatsapp:111",
      }),
    );
    expect(sink.onTurn).not.toHaveBeenCalled();
    expect(await history.read("whatsapp:111")).toHaveLength(0);
  });

  it("emits an interaction for a button_reply", async () => {
    const sink = makeSink();
    const value: ChangeValue = {
      messages: [
        {
          from: "111",
          id: "wamid.3",
          type: "interactive",
          interactive: {
            type: "button_reply",
            button_reply: { id: "ck:1", title: "Yes" },
          },
        },
      ],
    };
    await handleWebhookValue(value, baseArgs(sink));
    expect(sink.onInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ck:1" }),
    );
  });

  it("ignores status receipts", async () => {
    const sink = makeSink();
    await handleWebhookValue({ statuses: [{}] } as ChangeValue, baseArgs(sink));
    expect(sink.onTurn).not.toHaveBeenCalled();
    expect(sink.onInteraction).not.toHaveBeenCalled();
  });

  it("emits a turn for inbound media and stores multimodal content", async () => {
    const sink = makeSink();
    const history = new InMemoryHistoryStore();
    const client = {
      downloadMedia: async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/png",
      }),
    } as any;
    const value: ChangeValue = {
      messages: [
        {
          from: "111",
          id: "wamid.m",
          type: "image",
          image: { id: "MID", mime_type: "image/png", caption: "look" },
        } as any,
      ],
    };
    await handleWebhookValue(value, { ...baseArgs(sink, history), client });
    expect(sink.onTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: "whatsapp:111",
        userText: "look",
        platform: "whatsapp",
      }),
    );
    const stored = await history.read("whatsapp:111");
    expect(stored).toHaveLength(1);
    expect(Array.isArray(stored[0]!.content)).toBe(true);
  });

  it("notes a media download failure instead of throwing", async () => {
    const sink = makeSink();
    const history = new InMemoryHistoryStore();
    const client = {
      downloadMedia: async () => {
        throw new Error("boom");
      },
    } as any;
    const value: ChangeValue = {
      messages: [
        {
          from: "111",
          id: "wamid.m2",
          type: "image",
          image: { id: "MID", mime_type: "image/png" },
        } as any,
      ],
    };
    await handleWebhookValue(value, { ...baseArgs(sink, history), client });
    const stored = await history.read("whatsapp:111");
    // download failed → a note is appended to content as a text part ("failed to download …")
    // so the turn IS stored and emitted (the note is the only content item)
    expect(stored).toHaveLength(1);
    expect(Array.isArray(stored[0]!.content)).toBe(true);
    const content = stored[0]!.content as Array<{
      type: string;
      text?: string;
    }>;
    expect(
      content.some(
        (p) => p.type === "text" && p.text?.includes("failed to download"),
      ),
    ).toBe(true);
    expect(sink.onTurn).toHaveBeenCalled();
  });
});
