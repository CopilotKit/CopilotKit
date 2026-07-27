import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { StateStore } from "../state/state-store.js";

/** Registers the full StateStore contract as Vitest tests against a backend. */
export function runStateStoreConformance(
  name: string,
  make: () => StateStore | Promise<StateStore>,
  teardown?: (s: StateStore) => Promise<void>,
): void {
  describe(`StateStore conformance: ${name}`, () => {
    let s: StateStore;
    beforeEach(async () => {
      s = await make();
    });
    afterEach(async () => {
      await teardown?.(s);
    });

    describe("kv", () => {
      it("set/get/delete round-trips", async () => {
        await s.kv.set("a", { n: 1 });
        expect(await s.kv.get<{ n: number }>("a")).toEqual({ n: 1 });
        await s.kv.delete("a");
        expect(await s.kv.get("a")).toBeUndefined();
      });
      it("missing key is undefined", async () =>
        expect(await s.kv.get("nope")).toBeUndefined());
      it("expires after ttl", async () => {
        await s.kv.set("t", 1, 30);
        await new Promise((r) => setTimeout(r, 60));
        expect(await s.kv.get("t")).toBeUndefined();
      });
    });

    describe("list", () => {
      it("appends oldest-first and ranges", async () => {
        await s.list.append("L", "a");
        await s.list.append("L", "b");
        await s.list.append("L", "c");
        expect(await s.list.range<string>("L")).toEqual(["a", "b", "c"]);
        expect(await s.list.range<string>("L", 0, 1)).toEqual(["a", "b"]);
      });
      it("caps with maxLen on append (drops oldest)", async () => {
        for (const v of ["a", "b", "c", "d"])
          await s.list.append("C", v, { maxLen: 2 });
        expect(await s.list.range<string>("C")).toEqual(["c", "d"]);
      });
      it("trim keeps newest maxLen", async () => {
        for (const v of ["a", "b", "c"]) await s.list.append("T", v);
        await s.list.trim("T", 2);
        expect(await s.list.range<string>("T")).toEqual(["b", "c"]);
      });
      it("delete clears", async () => {
        await s.list.append("D", "x");
        await s.list.delete("D");
        expect(await s.list.range("D")).toEqual([]);
      });
      it("mixed ttl/non-ttl append keeps whole-list expiry", async () => {
        await s.list.append("M", "a", { ttlMs: 1000 });
        await s.list.append("M", "b"); // no ttlMs: must not clobber the existing expiry
        await new Promise((r) => setTimeout(r, 40));
        expect((await s.list.range<string>("M")).length).toBe(2);
      });
    });

    describe("lock", () => {
      it("acquire blocks a second acquire until release", async () => {
        const a = await s.lock.acquire("k");
        expect(a).not.toBeNull();
        expect(await s.lock.acquire("k")).toBeNull();
        await s.lock.release("k", a!.token);
        const b = await s.lock.acquire("k");
        expect(b).not.toBeNull();
      });
      it("release with a stale token does not free a re-acquired lock", async () => {
        const a = await s.lock.acquire("k", { ttlMs: 20 });
        await new Promise((r) => setTimeout(r, 40)); // a expires
        const b = await s.lock.acquire("k");
        expect(b).not.toBeNull();
        await s.lock.release("k", a!.token); // stale — must NOT release b
        expect(await s.lock.acquire("k")).toBeNull();
        await s.lock.release("k", b!.token);
      });
    });

    describe("dedup", () => {
      it("first seen false, second true, within ttl", async () => {
        expect(await s.dedup.seen("e1", 1000)).toBe(false);
        expect(await s.dedup.seen("e1", 1000)).toBe(true);
      });
      it("forgets after ttl", async () => {
        expect(await s.dedup.seen("e2", 30)).toBe(false);
        await new Promise((r) => setTimeout(r, 60));
        expect(await s.dedup.seen("e2", 30)).toBe(false);
      });
    });

    describe("queue", () => {
      it("FIFO enqueue/dequeue/depth", async () => {
        await s.queue.enqueue("q", 1);
        await s.queue.enqueue("q", 2);
        expect(await s.queue.depth("q")).toBe(2);
        expect(await s.queue.dequeue<number>("q")).toBe(1);
        expect(await s.queue.dequeue<number>("q")).toBe(2);
        expect(await s.queue.dequeue("q")).toBeUndefined();
      });
      it("maxSize + drop-oldest evicts the head", async () => {
        for (const v of [1, 2, 3])
          await s.queue.enqueue("q2", v, { maxSize: 2, onFull: "drop-oldest" });
        expect(await s.queue.dequeue<number>("q2")).toBe(2);
        expect(await s.queue.dequeue<number>("q2")).toBe(3);
      });
      it("maxSize + drop-newest rejects the incoming", async () => {
        for (const v of [1, 2, 3])
          await s.queue.enqueue("q3", v, { maxSize: 2, onFull: "drop-newest" });
        expect(await s.queue.dequeue<number>("q3")).toBe(1);
        expect(await s.queue.dequeue<number>("q3")).toBe(2);
      });
    });

    it("kv and lock keyspaces do not collide", async () => {
      await s.kv.set("x", { v: 1 });
      const a = await s.lock.acquire("x");
      expect(a).not.toBeNull();
      expect(await s.kv.get("x")).toEqual({ v: 1 });
      await s.lock.release("x", a!.token);
    });
  });
}
