import { describe, it, expect, vi } from "vitest";
import { runStateStoreConformance } from "../testing/state-store-conformance.js";
import { MemoryStore } from "./memory-store.js";

runStateStoreConformance("MemoryStore", () => new MemoryStore());

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
