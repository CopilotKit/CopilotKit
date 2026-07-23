import { describe, it, expect } from "vitest";
import { WhatsAppConversationStore } from "./conversation-store.js";
import { InMemoryHistoryStore } from "./history-store.js";

function fakeAgent(threadId: string) {
  return { threadId, messages: [] as unknown[], addMessage() {} } as any;
}

describe("WhatsAppConversationStore", () => {
  it("replays stored history into agent.messages with a fresh threadId", async () => {
    const history = new InMemoryHistoryStore();
    await history.append("whatsapp:111", {
      role: "user",
      content: "hi",
      ts: "1",
    });
    await history.append("whatsapp:111", {
      role: "assistant",
      content: "hello",
      ts: "2",
    });
    const store = new WhatsAppConversationStore({ historyStore: history });

    const target = { to: "111", phoneNumberId: "P" };
    const s1 = await store.getOrCreate("whatsapp:111", target, fakeAgent);
    const s2 = await store.getOrCreate("whatsapp:111", target, fakeAgent);

    expect(s1.agent.messages).toHaveLength(2);
    expect(s1.agent.messages[0]).toMatchObject({ role: "user", content: "hi" });
    expect((s1 as any).threadId).not.toBe((s2 as any).threadId); // fresh per turn
    expect((s1 as any).threadId).toMatch(/^whatsapp-111-/);
  });

  it("getMessages maps stored history into ThreadMessage[]", async () => {
    const history = new InMemoryHistoryStore();
    await history.append("whatsapp:111", {
      role: "assistant",
      content: "yo",
      ts: "9",
    });
    const store = new WhatsAppConversationStore({ historyStore: history });
    const out = await store.getMessages({ to: "111", phoneNumberId: "P" });
    expect(out).toEqual([{ text: "yo", isBot: true, ts: "9" }]);
  });
});
