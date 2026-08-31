import { describe, it, expect, vi } from "vitest";
import { InMemoryActionStore } from "./action-store.js";

describe("InMemoryActionStore", () => {
  it("puts and gets a snapshot", async () => {
    const s = new InMemoryActionStore();
    await s.put("id1", { path: [0], conversationKey: "c" });
    expect(await s.get("id1")).toMatchObject({ path: [0] });
  });
  it("expires entries past ttl", async () => {
    vi.useFakeTimers();
    try {
      const s = new InMemoryActionStore();
      await s.put("id1", { path: [0], conversationKey: "c" }, 1000);
      vi.advanceTimersByTime(1500);
      expect(await s.get("id1")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
  it("deletes entries", async () => {
    const s = new InMemoryActionStore();
    await s.put("id1", { path: [0], conversationKey: "c" });
    await s.delete("id1");
    expect(await s.get("id1")).toBeUndefined();
  });
});
