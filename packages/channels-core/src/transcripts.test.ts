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
    await t.append(
      thread,
      { role: "user", text: "hi" },
      { userKey: "u@x.com" },
    );
    await t.append(
      thread,
      { role: "assistant", text: "hello" },
      { userKey: "u@x.com" },
    );
    const all = await t.list({ userKey: "u@x.com" });
    expect(all.map((e) => e.role)).toEqual(["user", "assistant"]);
    expect(await t.list({ userKey: "u@x.com", roles: ["user"] })).toHaveLength(
      1,
    );
  });
  it("delete wipes and reports count", async () => {
    const t = new Transcripts(new MemoryStore());
    await t.append(thread, { role: "user", text: "x" }, { userKey: "k" });
    expect(await t.delete({ userKey: "k" })).toEqual({ deleted: 1 });
    expect(await t.list({ userKey: "k" })).toEqual([]);
  });

  it("TTL expiry: entries not visible after retention window", async () => {
    const t = new Transcripts(new MemoryStore(), { retention: "30ms" });
    await t.append(thread, { role: "user", text: "hi" }, { userKey: "u" });
    await new Promise((r) => setTimeout(r, 60));
    expect(await t.list({ userKey: "u" })).toEqual([]);
  });

  it("maxPerUser: only newest N entries are kept", async () => {
    const t = new Transcripts(new MemoryStore(), { maxPerUser: 2 });
    await t.append(thread, { role: "user", text: "1" }, { userKey: "u" });
    await t.append(thread, { role: "user", text: "2" }, { userKey: "u" });
    await t.append(thread, { role: "user", text: "3" }, { userKey: "u" });
    const entries = await t.list({ userKey: "u" });
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.text)).toEqual(["2", "3"]);
  });

  it("no userKey resolved: no-op, list returns empty for any key", async () => {
    const t = new Transcripts(new MemoryStore());
    // neither opts.userKey nor msg.userKey is set
    await t.append(thread, { role: "user", text: "ghost" });
    expect(await t.list({ userKey: "anyone" })).toEqual([]);
  });

  it("list with limit: returns only the last N entries", async () => {
    const t = new Transcripts(new MemoryStore());
    await t.append(thread, { role: "user", text: "a" }, { userKey: "u" });
    await t.append(thread, { role: "user", text: "b" }, { userKey: "u" });
    await t.append(thread, { role: "user", text: "c" }, { userKey: "u" });
    const last = await t.list({ userKey: "u", limit: 1 });
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
      await t.append(thread, { role: "user", text: "old" }, { userKey: "u" });
      vi.advanceTimersByTime(2 * 60 * 60 * 1000); // advance 2h
      expect(await t.list({ userKey: "u" })).toEqual([]);
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
      await t.append(thread, { role: "user", text: "A" }, { userKey: "u" });
      vi.advanceTimersByTime(50 * 60 * 1000); // +50m: A still within window, key TTL refreshed to +110m
      await t.append(thread, { role: "user", text: "B" }, { userKey: "u" });
      vi.advanceTimersByTime(50 * 60 * 1000); // +100m: key still live (expires +110m), but A is now 100m old
      await t.append(thread, { role: "user", text: "C" }, { userKey: "u" });
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
      await t.append(thread, { role: "user", text: "A" }, { userKey: "u" });
      vi.advanceTimersByTime(30 * 60 * 1000); // advance 30m — A still within 1h
      await t.append(thread, { role: "user", text: "B" }, { userKey: "u" });
      const entries = await t.list({ userKey: "u" });
      expect(entries).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
