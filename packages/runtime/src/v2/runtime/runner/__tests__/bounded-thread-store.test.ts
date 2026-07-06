import { describe, it, expect } from "vitest";
import { ɵestimateBytes, ɵINMEMORY_DEFAULTS } from "../in-memory";
import { ɵBoundedThreadStore } from "../in-memory";

const limits = (over: Partial<Record<"maxThreads" | "maxRunsPerThread" | "maxBytes", number>> = {}) => ({
  ...ɵINMEMORY_DEFAULTS,
  ...over,
});

describe("ɵestimateBytes", () => {
  it("approximates size from serialized content", () => {
    const small = ɵestimateBytes({ a: "x" });
    const large = ɵestimateBytes({ a: "x".repeat(1000) });
    expect(large).toBeGreaterThan(small);
    expect(large).toBeGreaterThanOrEqual(1000);
  });

  it("returns 0 and never throws on non-serializable input", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => ɵestimateBytes(circular)).not.toThrow();
    expect(ɵestimateBytes(circular)).toBe(0);
    expect(ɵestimateBytes(undefined)).toBe(0);
  });
});

describe("ɵINMEMORY_DEFAULTS", () => {
  it("matches the spec's default limits", () => {
    expect(ɵINMEMORY_DEFAULTS).toEqual({
      maxThreads: 1000,
      maxRunsPerThread: 100,
      maxBytes: 512 * 1024 ** 2,
    });
  });
});

describe("ɵBoundedThreadStore — threads & LRU", () => {
  it("getOrCreate creates once and reuses", () => {
    const store = new ɵBoundedThreadStore(limits());
    const a = store.getOrCreate("t1");
    const b = store.getOrCreate("t1");
    expect(a).toBe(b);
    expect(store.size).toBe(1);
  });

  it("evicts the least-recently-used thread past maxThreads", () => {
    const store = new ɵBoundedThreadStore(limits({ maxThreads: 2 }));
    store.getOrCreate("t1");
    store.getOrCreate("t2");
    store.getOrCreate("t3"); // over cap → evicts t1 (LRU)
    expect(store.size).toBe(2);
    expect(store.peek("t1")).toBeUndefined();
    expect(store.peek("t2")).toBeDefined();
    expect(store.peek("t3")).toBeDefined();
  });

  it("get({ touch: true }) rescues a thread from eviction; peek does not", () => {
    const store = new ɵBoundedThreadStore(limits({ maxThreads: 2 }));
    store.getOrCreate("t1");
    store.getOrCreate("t2");
    store.get("t1", { touch: true }); // t1 now MRU; t2 is LRU
    store.getOrCreate("t3"); // evicts t2
    expect(store.peek("t1")).toBeDefined();
    expect(store.peek("t2")).toBeUndefined();
  });

  it("peek does NOT touch LRU (listThreads-style access cannot rescue)", () => {
    const store = new ɵBoundedThreadStore(limits({ maxThreads: 2 }));
    store.getOrCreate("t1");
    store.getOrCreate("t2");
    store.peek("t1"); // must NOT move t1 to MRU
    store.getOrCreate("t3"); // t1 still LRU → evicted
    expect(store.peek("t1")).toBeUndefined();
    expect(store.peek("t2")).toBeDefined();
  });

  it("never evicts a running thread", () => {
    const store = new ɵBoundedThreadStore(limits({ maxThreads: 2 }));
    const t1 = store.getOrCreate("t1");
    t1.isRunning = true; // t1 is LRU but running
    store.getOrCreate("t2");
    store.getOrCreate("t3"); // would evict t1, but it's running → t2 goes instead
    expect(store.peek("t1")).toBeDefined();
    expect(store.peek("t2")).toBeUndefined();
    expect(store.size).toBe(2);
  });

  it("accepts overage when every evictable thread is running", () => {
    const store = new ɵBoundedThreadStore(limits({ maxThreads: 1 }));
    const t1 = store.getOrCreate("t1");
    t1.isRunning = true;
    const t2 = store.getOrCreate("t2");
    t2.isRunning = true; // both running, over cap → accept overage
    expect(store.size).toBe(2);
  });

  it("clear resets the map and size", () => {
    const store = new ɵBoundedThreadStore(limits());
    store.getOrCreate("t1");
    store.clear();
    expect(store.size).toBe(0);
    expect(store.peek("t1")).toBeUndefined();
  });
});
