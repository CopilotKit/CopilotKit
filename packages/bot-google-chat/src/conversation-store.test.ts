import { describe, it, expect, vi } from "vitest";
import {
  GoogleChatConversationStore,
  isBotStatusOrPlaceholder,
} from "./conversation-store.js";

function makeStore(messages: any[]) {
  const client = { listMessages: vi.fn(async () => messages) } as any;
  return new GoogleChatConversationStore({ client, botUserId: "users/BOT" });
}

describe("GoogleChatConversationStore.getOrCreate", () => {
  it("builds agent history from listMessages, including bot replies as assistant turns", async () => {
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

  it("scopes the history fetch to the thread when scope is a thread resource name", async () => {
    const client = { listMessages: vi.fn(async () => []) } as any;
    const store = new GoogleChatConversationStore({ client, botUserId: "users/BOT" });
    await store.getOrCreate(
      { spaceId: "spaces/A", scope: "spaces/A/threads/T" },
      { space: "spaces/A", thread: "spaces/A/threads/T" },
      () => ({ messages: [] }) as any,
    );
    expect(client.listMessages).toHaveBeenCalledTimes(1);
    const args = client.listMessages.mock.calls[0] as any[];
    expect(args[0]).toBe("spaces/A");
    expect(args[1]).toEqual({ threadName: "spaces/A/threads/T" });
  });

  it("does NOT scope to a thread for DM scope (whole space)", async () => {
    const client = { listMessages: vi.fn(async () => []) } as any;
    const store = new GoogleChatConversationStore({ client, botUserId: "users/BOT" });
    await store.getOrCreate(
      { spaceId: "spaces/A", scope: "dm" },
      { space: "spaces/A" },
      () => ({ messages: [] }) as any,
    );
    expect(client.listMessages).toHaveBeenCalledTimes(1);
    const args = client.listMessages.mock.calls[0] as any[];
    expect(args[0]).toBe("spaces/A");
    // No threadName opts passed for DM scope.
    expect(args[1]).toBeUndefined();
  });

  it("treats a non-BOT-typed sender matching botUserId as an assistant turn (secondary guard)", async () => {
    // botUserId is "users/BOT" (see makeStore). A sender whose type isn't "BOT"
    // but whose name matches botUserId must still be recognized as the bot via
    // the shared isBotSender predicate — provably matching adapter.getMessages.
    const store = makeStore([
      { name: "m1", text: "hello", sender: { name: "users/1", type: "HUMAN" } },
      { name: "m2", text: "hi there", sender: { name: "users/BOT", type: "HUMAN" } },
    ]);
    const captured = { messages: [] as any[] };
    await store.getOrCreate(
      { spaceId: "spaces/A", scope: "spaces/A/threads/T" },
      { space: "spaces/A", thread: "spaces/A/threads/T" },
      () => captured as any,
    );
    expect(captured.messages).toHaveLength(2);
    expect(captured.messages[0]).toMatchObject({ role: "user", content: "hello" });
    expect(captured.messages[1]).toMatchObject({ role: "assistant", content: "hi there" });
  });

  it("excludes bot status rows (🔧 / ✅ / ⏹ / _thinking…_ / _…(continued)_) from translated history", async () => {
    const store = makeStore([
      { name: "m1", text: "what can you do?", sender: { name: "users/1", type: "HUMAN" } },
      // tool-call start row — must be excluded
      { name: "m2", text: "🔧 `search`…", sender: { name: "users/BOT", type: "BOT" } },
      // tool-call end row — must be excluded
      { name: "m3", text: "✅ `search`", sender: { name: "users/BOT", type: "BOT" } },
      // interrupted tool-status row — must be excluded
      { name: "m3b", text: "⏹ `search`", sender: { name: "users/BOT", type: "BOT" } },
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

describe("isBotStatusOrPlaceholder", () => {
  it("matches tool-status rows and stream placeholders", () => {
    expect(isBotStatusOrPlaceholder("🔧 `search`…")).toBe(true);
    expect(isBotStatusOrPlaceholder("✅ `search`")).toBe(true);
    expect(isBotStatusOrPlaceholder("⏹ `search`")).toBe(true);
    expect(isBotStatusOrPlaceholder("_thinking…_")).toBe(true);
    expect(isBotStatusOrPlaceholder("_…(continued)_")).toBe(true);
  });

  it("does not match real reply text", () => {
    expect(isBotStatusOrPlaceholder("Here is the answer.")).toBe(false);
    expect(isBotStatusOrPlaceholder("thinking about it")).toBe(false);
    expect(isBotStatusOrPlaceholder("")).toBe(false);
  });
});
