import { describe, it, expect, vi } from "vitest";
import { runStateStoreConformance } from "../testing/state-store-conformance.js";
import { MemoryStore } from "./memory-store.js";

runStateStoreConformance("MemoryStore", () => new MemoryStore());

describe("MemoryStore dedup expiry", () => {
  it("keeps the original TTL through repeated seen calls, including the expiry boundary", async () => {
    vi.useFakeTimers();
    try {
      const s = new MemoryStore();
      expect(await s.dedup.seen("x", 1000)).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(await s.dedup.seen("x", 10_000)).toBe(true);
      vi.advanceTimersByTime(1);
      expect(await s.dedup.seen("x", 1000)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sweeps expired dedup and KV entries on the existing KV write cadence", async () => {
    vi.useFakeTimers();
    try {
      const s = new MemoryStore();
      // Inspect storage only to verify cleanup of entries nobody reads.
      const maps = Object.values(s).filter((value) => value instanceof Map);
      const storedEntries = () =>
        maps.reduce((count, map) => count + map.size, 0);
      await s.kv.set("expired", 1, 10);
      await s.kv.set("kept", 1);
      await s.dedup.seen("expired", 10);
      await s.dedup.seen("kept", 10_000);
      vi.advanceTimersByTime(11);

      for (let i = 0; i < 253; i++) await s.kv.set("sweep-trigger", 1);
      expect(storedEntries()).toBe(5);
      await s.kv.set("sweep-trigger", 1); // the 256th KV write
      expect(storedEntries()).toBe(3);
      expect(await s.kv.get("kept")).toBe(1);
      expect(await s.dedup.seen("kept", 1000)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("MemoryStore lock default TTL", () => {
  it("auto-expires a no-ttl lock after the 30s default (not immortal)", async () => {
    vi.useFakeTimers();
    try {
      const s = new MemoryStore();
      const a = await s.lock.acquire("k"); // no ttlMs
      expect(a).not.toBeNull();
      vi.advanceTimersByTime(29_000);
      expect(await s.lock.acquire("k")).toBeNull(); // still held before 30s
      vi.advanceTimersByTime(2_000); // now past 30s
      const b = await s.lock.acquire("k");
      expect(b).not.toBeNull(); // expired -> re-acquirable
    } finally {
      vi.useRealTimers();
    }
  });
});
