import { describe, it, expect, vi } from "vitest";
import { TelegramConversationStore } from "../conversation-store.js";

describe("TelegramConversationStore", () => {
  it("creates a stable agent session per conversation key", async () => {
    const store = new TelegramConversationStore();
    const makeAgent = vi.fn((threadId: string) => ({ threadId }) as any);
    const a = await store.getOrCreate("tg:1:dm", { chatId: 1 }, makeAgent);
    const b = await store.getOrCreate("tg:1:dm", { chatId: 1 }, makeAgent);
    expect(a.agent).toBe(b.agent);
    expect(makeAgent).toHaveBeenCalledTimes(1);
  });
  it("records and returns history", () => {
    const store = new TelegramConversationStore();
    store.recordMessage("tg:1:dm", { text: "hi", isBot: false });
    expect(store.getMessages("tg:1:dm")).toEqual([
      { text: "hi", isBot: false },
    ]);
  });

  it("drains an enqueued text user message into the agent on getOrCreate", async () => {
    const store = new TelegramConversationStore();
    const addMessage = vi.fn();
    const makeAgent = vi.fn(() => ({ addMessage }) as any);

    store.enqueueUserMessage("tg:1:dm", "hi");
    await store.getOrCreate("tg:1:dm", { chatId: 1 }, makeAgent);

    expect(addMessage).toHaveBeenCalledTimes(1);
    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content: "hi" }),
    );
    expect(typeof addMessage.mock.calls[0]?.[0]?.id).toBe("string");
  });

  it("drains enqueued array (text + image) content into the agent", async () => {
    const store = new TelegramConversationStore();
    const addMessage = vi.fn();
    const makeAgent = vi.fn(() => ({ addMessage }) as any);

    const content = [
      { type: "text", text: "look" },
      {
        type: "image",
        source: { type: "data", value: "AAA", mimeType: "image/jpeg" },
      },
    ] as any;
    store.enqueueUserMessage("tg:1:dm", content);
    await store.getOrCreate("tg:1:dm", { chatId: 1 }, makeAgent);

    expect(addMessage).toHaveBeenCalledTimes(1);
    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content }),
    );
  });

  it("clears pending after draining so a second getOrCreate does not re-add", async () => {
    const store = new TelegramConversationStore();
    const addMessage = vi.fn();
    const makeAgent = vi.fn(() => ({ addMessage }) as any);

    store.enqueueUserMessage("tg:1:dm", "hi");
    await store.getOrCreate("tg:1:dm", { chatId: 1 }, makeAgent);
    await store.getOrCreate("tg:1:dm", { chatId: 1 }, makeAgent);

    expect(addMessage).toHaveBeenCalledTimes(1);
  });
});
