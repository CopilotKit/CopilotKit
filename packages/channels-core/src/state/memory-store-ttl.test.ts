import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "./memory-store";

// A fake clock keeps these deterministic: `live()` compares against Date.now(),
// so a real 30ms window can be missed (or a paused run can trip it) and make the
// assertions flaky rather than testing the expiry rule.
const START = new Date("2026-01-01T00:00:00.000Z");

describe("MemoryStore explicit zero ttl", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires a kv key immediately when the ttl is 0", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const store = new MemoryStore();

    await store.kv.set("k", 1, 0);

    expect(await store.kv.get("k")).toBeUndefined();
  });

  it("expires a list entry immediately when the ttl is 0", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const store = new MemoryStore();

    await store.list.append("L", "a", { ttlMs: 0 });

    expect(await store.list.range<string>("L")).toEqual([]);
  });

  it("keeps a kv key readable when no ttl is supplied", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const store = new MemoryStore();

    await store.kv.set("k", 1);
    vi.advanceTimersByTime(60_000);

    expect(await store.kv.get("k")).toBe(1);
  });

  it("still honours a positive ttl", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const store = new MemoryStore();

    await store.kv.set("k", 1, 30);
    expect(await store.kv.get("k")).toBe(1);

    vi.advanceTimersByTime(31);
    expect(await store.kv.get("k")).toBeUndefined();
  });
});
