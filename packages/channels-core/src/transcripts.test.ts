import { describe, it, expect, vi } from "vitest";
import { MemoryStore } from "./state/memory-store.js";
import { Transcripts } from "./transcripts.js";
import type { Thread } from "@copilotkit/channels-ui";

const thread: Pick<Thread, "platform"> & { conversationKey: string } = {
  platform: "slack",
  conversationKey: "slack:C1:1",
};

describe("Transcripts", () => {
  it("appends and lists oldest-first, filters compose", async () => {
    const t = new Transcripts(new MemoryStore(), { maxPerUser: 100 });
    await t.append(thread, { role: "user", text: "hi" }, { userId: "u@x.com" });
    await t.append(
      thread,
      { role: "assistant", text: "hello" },
      { userId: "u@x.com" },
    );
    const all = await t.list({ userId: "u@x.com" });
    expect(all.map((e) => e.role)).toEqual(["user", "assistant"]);
    expect(await t.list({ userId: "u@x.com", roles: ["user"] })).toHaveLength(
      1,
    );
  });
  it("delete wipes and reports count", async () => {
    const t = new Transcripts(new MemoryStore());
    await t.append(thread, { role: "user", text: "x" }, { userId: "k" });
    expect(await t.delete({ userId: "k" })).toEqual({ deleted: 1 });
    expect(await t.list({ userId: "k" })).toEqual([]);
  });

  it("TTL expiry: entries not visible after retention window", async () => {
    const t = new Transcripts(new MemoryStore(), { retention: "30ms" });
    await t.append(thread, { role: "user", text: "hi" }, { userId: "u" });
    await new Promise((r) => setTimeout(r, 60));
    expect(await t.list({ userId: "u" })).toEqual([]);
  });

  it("maxPerUser: only newest N entries are kept", async () => {
    const t = new Transcripts(new MemoryStore(), { maxPerUser: 2 });
    await t.append(thread, { role: "user", text: "1" }, { userId: "u" });
    await t.append(thread, { role: "user", text: "2" }, { userId: "u" });
    await t.append(thread, { role: "user", text: "3" }, { userId: "u" });
    const entries = await t.list({ userId: "u" });
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.text)).toEqual(["2", "3"]);
  });

  it("no userId resolved: no-op, list returns empty for any key", async () => {
    const t = new Transcripts(new MemoryStore());
    await t.append(thread, { role: "user", text: "ghost" }, { userId: null });
    expect(await t.list({ userId: "anyone" })).toEqual([]);
  });

  it("list with limit: returns only the last N entries", async () => {
    const t = new Transcripts(new MemoryStore());
    await t.append(thread, { role: "user", text: "a" }, { userId: "u" });
    await t.append(thread, { role: "user", text: "b" }, { userId: "u" });
    await t.append(thread, { role: "user", text: "c" }, { userId: "u" });
    const last = await t.list({ userId: "u", limit: 1 });
    expect(last).toHaveLength(1);
    expect(last[0]!.text).toBe("c");
  });

  it("bogus retention string throws at construction", () => {
    expect(
      () => new Transcripts(new MemoryStore(), { retention: "bogus" }),
    ).toThrow();
  });
});

describe("Transcripts retention", () => {
  it("list() does not return entries older than the retention window", async () => {
    const store = new MemoryStore();
    const t = new Transcripts(store, { retention: "1h" });
    vi.useFakeTimers();
    try {
      await t.append(thread, { role: "user", text: "old" }, { userId: "u" });
      vi.advanceTimersByTime(2 * 60 * 60 * 1000); // advance 2h
      expect(await t.list({ userId: "u" })).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("append prunes entries older than retention while the list is kept alive", async () => {
    // Isolates the prune path from the whole-key sliding TTL: each append
    // refreshes the 1h key TTL, so the list never expires wholesale. A is
    // only ever removed by the per-entry age prune — if the prune block were
    // deleted, the whole-key TTL would keep all three entries alive and this
    // would read length 3.
    const store = new MemoryStore();
    const t = new Transcripts(store, { retention: "1h" });
    vi.useFakeTimers();
    try {
      await t.append(thread, { role: "user", text: "A" }, { userId: "u" });
      vi.advanceTimersByTime(50 * 60 * 1000); // +50m: A still within window, key TTL refreshed to +110m
      await t.append(thread, { role: "user", text: "B" }, { userId: "u" });
      vi.advanceTimersByTime(50 * 60 * 1000); // +100m: key still live (expires +110m), but A is now 100m old
      await t.append(thread, { role: "user", text: "C" }, { userId: "u" });
      const raw = await store.list.range<{ text: string }>("transcript:user:u");
      expect(raw.map((e) => e.text)).toEqual(["B", "C"]); // A pruned by age, not whole-key expiry
    } finally {
      vi.useRealTimers();
    }
  });

  it("recent entries within the window are kept", async () => {
    const store = new MemoryStore();
    const t = new Transcripts(store, { retention: "1h" });
    vi.useFakeTimers();
    try {
      await t.append(thread, { role: "user", text: "A" }, { userId: "u" });
      vi.advanceTimersByTime(30 * 60 * 1000); // advance 30m — A still within 1h
      await t.append(thread, { role: "user", text: "B" }, { userId: "u" });
      const entries = await t.list({ userId: "u" });
      expect(entries).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
