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
});
