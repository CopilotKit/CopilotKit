import { describe, it, expect, vi } from "vitest";
import { DiscordConversationStore } from "./conversation-store.js";
import type { DiscordHistoryMessage } from "./conversation-store.js";

/** Captures the `messages` assigned onto the fake agent by the store. */
function fakeAgent() {
  return { threadId: "", messages: undefined as unknown } as any;
}

describe("DiscordConversationStore", () => {
  it("reconstructs channel history into AG-UI messages each turn", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    // A stubbed fetch for buildFileContentParts so no real network happens.
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => pngBytes.buffer,
    })) as unknown as typeof fetch;

    const history: DiscordHistoryMessage[] = [
      {
        id: "m1",
        content: "<@123> hey bot",
        authorId: "u1",
        authorIsBot: false,
        attachments: [],
      },
      {
        id: "m2",
        content: "_thinking…_", // bot placeholder — must be skipped
        authorId: "bot-1",
        authorIsBot: true,
        attachments: [],
      },
      {
        id: "m3",
        content: "here is the",
        authorId: "bot-1",
        authorIsBot: true,
        attachments: [],
      },
      {
        id: "m4",
        content: "real answer", // consecutive bot string → folded into m3
        authorId: "bot-1",
        authorIsBot: true,
        attachments: [],
      },
      {
        id: "m5",
        content: "<@123> look at this",
        authorId: "u1",
        authorIsBot: false,
        attachments: [
          {
            url: "https://cdn.discord/a.png",
            name: "a.png",
            contentType: "image/png",
            size: pngBytes.length,
          },
        ],
      },
    ];

    const fetchHistory = vi.fn(async () => history);
    const store = new DiscordConversationStore({
      fetchHistory,
      botUserId: () => "bot-1",
      filesConfig: { fetchImpl },
    });

    const agent = fakeAgent();
    const session = await store.getOrCreate(
      "c1",
      { channelId: "c1" },
      () => agent,
    );

    expect(fetchHistory).toHaveBeenCalledWith("c1");
    expect(session.agent).toBe(agent);
    expect(agent.messages).toEqual([
      // user text, mention token stripped
      { id: "m1", role: "user", content: "hey bot" },
      // placeholder skipped; two consecutive bot strings folded into one turn
      { id: "m3", role: "assistant", content: "here is the\nreal answer" },
      // user message with an image → multimodal content (text part + image part)
      {
        id: "m5",
        role: "user",
        content: [
          { type: "text", text: "look at this" },
          {
            type: "image",
            source: {
              type: "data",
              value: Buffer.from(pngBytes).toString("base64"),
              mimeType: "image/png",
            },
          },
        ],
      },
    ]);
  });

  it("rebuilds from the channel every turn (no in-memory caching)", async () => {
    const fetchHistory = vi.fn(async () => [] as DiscordHistoryMessage[]);
    const store = new DiscordConversationStore({
      fetchHistory,
      botUserId: () => "bot-1",
    });
    const makeAgent = vi.fn(() => fakeAgent());
    await store.getOrCreate("c1", { channelId: "c1" }, makeAgent);
    await store.getOrCreate("c1", { channelId: "c1" }, makeAgent);
    // A fresh agent + a fresh history fetch per turn — the channel is the
    // source of truth, so nothing is cached.
    expect(makeAgent).toHaveBeenCalledTimes(2);
    expect(fetchHistory).toHaveBeenCalledTimes(2);
  });
});
