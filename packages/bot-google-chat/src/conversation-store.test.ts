import { describe, it, expect, vi } from "vitest";
import { GoogleChatConversationStore } from "./conversation-store.js";

function makeStore(messages: any[]) {
  const client = { listMessages: vi.fn(async () => messages) } as any;
  return new GoogleChatConversationStore({ client, botUserId: "users/BOT" });
}

describe("GoogleChatConversationStore.getOrCreate", () => {
  it("builds agent history from listMessages, skipping the bot's own messages", async () => {
    const store = makeStore([
      { name: "m1", text: "hello", sender: { name: "users/1", type: "HUMAN" } },
      { name: "m2", text: "hi there", sender: { name: "users/BOT", type: "BOT" } },
    ]);
    let captured: any;
    const makeAgent = (threadId: string) => {
      captured = { threadId, messages: [] as any[] };
      return captured as any;
    };
    const session = await store.getOrCreate(
      { spaceId: "spaces/A", scope: "spaces/A/threads/T" },
      { space: "spaces/A", thread: "spaces/A/threads/T" },
      makeAgent,
    );
    expect(session.threadId).toContain("spaces/A");
    expect(captured.messages).toHaveLength(2);
    expect(captured.messages[0]).toMatchObject({ role: "user", content: "hello" });
    expect(captured.messages[1]).toMatchObject({ role: "assistant", content: "hi there" });
  });

  it("returns [] history when listMessages throws (no delegation)", async () => {
    const client = { listMessages: vi.fn(async () => { throw new Error("403"); }) } as any;
    const store = new GoogleChatConversationStore({ client, botUserId: "users/BOT" });
    const captured = { messages: [] as any[] };
    await store.getOrCreate(
      { spaceId: "spaces/A", scope: "dm" },
      { space: "spaces/A" },
      () => captured as any,
    );
    expect(captured.messages).toEqual([]);
  });

  it("excludes bot status rows (🔧 / ✅ / _thinking…_ / _…(continued)_) from translated history", async () => {
    const store = makeStore([
      { name: "m1", text: "what can you do?", sender: { name: "users/1", type: "HUMAN" } },
      // tool-call start row — must be excluded
      { name: "m2", text: "🔧 `search`…", sender: { name: "users/BOT", type: "BOT" } },
      // tool-call end row — must be excluded
      { name: "m3", text: "✅ `search`", sender: { name: "users/BOT", type: "BOT" } },
      // ChunkedMessageStream placeholders — must be excluded
      { name: "m4", text: "_thinking…_", sender: { name: "users/BOT", type: "BOT" } },
      { name: "m5", text: "_…(continued)_", sender: { name: "users/BOT", type: "BOT" } },
      // real assistant reply — must be included
      { name: "m6", text: "I can help with many things.", sender: { name: "users/BOT", type: "BOT" } },
    ]);
    const captured = { messages: [] as any[] };
    await store.getOrCreate(
      { spaceId: "spaces/A", scope: "spaces/A/threads/T" },
      { space: "spaces/A", thread: "spaces/A/threads/T" },
      () => captured as any,
    );
    expect(captured.messages).toHaveLength(2);
    expect(captured.messages[0]).toMatchObject({ role: "user", content: "what can you do?" });
    expect(captured.messages[1]).toMatchObject({ role: "assistant", content: "I can help with many things." });
  });
});
