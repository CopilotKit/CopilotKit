import { describe, it, expect, vi } from "vitest";
import { DiscordConversationStore } from "./conversation-store.js";

describe("DiscordConversationStore", () => {
  it("creates one session per conversation and reuses it", async () => {
    const store = new DiscordConversationStore();
    const makeAgent = vi.fn((threadId: string) => ({ threadId }) as any);
    const a = await store.getOrCreate("c1", { channelId: "c1" }, makeAgent);
    const b = await store.getOrCreate("c1", { channelId: "c1" }, makeAgent);
    expect(a).toBe(b);
    expect(makeAgent).toHaveBeenCalledTimes(1);
    expect(makeAgent).toHaveBeenCalledWith("c1");
  });

  it("creates distinct sessions for distinct conversations", async () => {
    const store = new DiscordConversationStore();
    const makeAgent = vi.fn((threadId: string) => ({ threadId }) as any);
    const a = await store.getOrCreate("c1", { channelId: "c1" }, makeAgent);
    const b = await store.getOrCreate("c2", { channelId: "c2" }, makeAgent);
    expect(a).not.toBe(b);
    expect(makeAgent).toHaveBeenCalledTimes(2);
  });
});
