import { describe, it, expect } from "vitest";
import { ɵestimateBytes, ɵINMEMORY_DEFAULTS } from "../in-memory";
import { ɵBoundedThreadStore } from "../in-memory";

const limits = (
  over: Partial<
    Record<"maxThreads" | "maxRunsPerThread" | "maxBytes", number>
  > = {},
) => ({
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

import type { BaseEvent, Message } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";

// Build a HistoricRun whose event/message payloads are sized by `pad` chars.
const makeRun = (
  threadId: string,
  runId: string,
  { eventPad = 0, msgPad = 0 }: { eventPad?: number; msgPad?: number } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any => ({
  threadId,
  runId,
  agentId: "a1",
  parentRunId: null,
  events: [
    {
      type: EventType.CUSTOM,
      value: "e".repeat(eventPad),
    } as unknown as BaseEvent,
  ],
  messages: [
    {
      id: `${runId}-m`,
      role: "assistant",
      content: "m".repeat(msgPad),
    } as unknown as Message,
  ],
  createdAt: 1,
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

  it("never evicts a stop-requested (finalizing) thread", () => {
    // Reproduces the stop() finalization window: stop() sets isRunning=false
    // while stopRequested stays true and the aborted run is still asynchronously
    // finalizing (its pending appendRun has not landed yet). Evicting the thread
    // here would make that appendRun hit `if (!store) return` and silently drop
    // the aborted run's history.
    const store = new ɵBoundedThreadStore(limits({ maxThreads: 1 }));
    const t1 = store.getOrCreate("t1");
    t1.isRunning = false; // stop() cleared the running flag ...
    t1.stopRequested = true; // ... but the run is still finalizing
    store.getOrCreate("t2"); // over cap → would evict t1 pre-fix, but it's finalizing
    expect(store.peek("t1")).toBeDefined(); // t1 survives → appendRun can still land
    expect(store.peek("t2")).toBeDefined();
    expect(store.size).toBe(2); // overage accepted, nothing dropped
  });

  it("clear resets the map and size", () => {
    const store = new ɵBoundedThreadStore(limits());
    store.getOrCreate("t1");
    store.clear();
    expect(store.size).toBe(0);
    expect(store.peek("t1")).toBeUndefined();
  });
});

describe("ɵBoundedThreadStore — appendRun", () => {
  it("enforces maxRunsPerThread FIFO (drops oldest)", () => {
    const store = new ɵBoundedThreadStore(limits({ maxRunsPerThread: 2 }));
    store.getOrCreate("t1");
    store.appendRun("t1", makeRun("t1", "r1"));
    store.appendRun("t1", makeRun("t1", "r2"));
    store.appendRun("t1", makeRun("t1", "r3"));
    const runs = store.peek("t1")!.historicRuns;
    expect(runs.map((r) => r.runId)).toEqual(["r2", "r3"]);
  });

  it("maxRunsPerThread = Infinity disables the run cap", () => {
    const store = new ɵBoundedThreadStore(
      limits({ maxRunsPerThread: Infinity }),
    );
    store.getOrCreate("t1");
    for (let i = 0; i < 500; i++) store.appendRun("t1", makeRun("t1", `r${i}`));
    expect(store.peek("t1")!.historicRuns.length).toBe(500);
  });

  it("maxRunsPerThread = 0 disables the run cap", () => {
    const store = new ɵBoundedThreadStore(limits({ maxRunsPerThread: 0 }));
    store.getOrCreate("t1");
    for (let i = 0; i < 300; i++) store.appendRun("t1", makeRun("t1", `r${i}`));
    expect(store.peek("t1")!.historicRuns.length).toBe(300);
  });

  it("keeps only the latest message snapshot at the thread level", () => {
    // R3-1: the snapshot is stored on the thread (store.messagesSnapshot), NOT
    // per HistoricRun. appendRun clears run.messages, so a newer non-empty run
    // replaces the thread snapshot and stored runs never carry messages.
    const store = new ɵBoundedThreadStore(limits());
    const s = store.getOrCreate("t1");
    store.appendRun("t1", makeRun("t1", "r1", { msgPad: 100 }));
    store.appendRun("t1", makeRun("t1", "r2", { msgPad: 100 }));
    const runs = store.peek("t1")!.historicRuns;
    // No HistoricRun carries a message snapshot anymore.
    expect(runs[0]!.messages).toEqual([]);
    expect(runs[1]!.messages).toEqual([]);
    // The single latest snapshot lives on the store and is the newest run's.
    expect(s.messagesSnapshot.length).toBe(1);
    expect(s.messagesSnapshot[0]!.id).toBe("r2-m");
  });

  it("stores the incoming array directly (shallow) — inner objects stay shared by reference", () => {
    // R6-1: the WRITE side stores a SHALLOW (array-level) copy, not a deep copy.
    // run() already makes a fresh `[...request.agent.messages]` array, so the store
    // owns the array and is decoupled at the array level. We deliberately do NOT
    // deep-copy: `structuredClone` throws DataCloneError on a non-cloneable message
    // field, wedging the thread. The tradeoff — a known limitation tracked as
    // follow-up — is that inner Message objects remain shared by reference, so an
    // agent mutating a message object IN PLACE after the run IS observable through
    // the stored snapshot. Callers must treat stored messages as read-only.
    const store = new ɵBoundedThreadStore(limits());
    const s = store.getOrCreate("t1");
    const run = makeRun("t1", "r1", { msgPad: 10 });
    // Hold a reference to the exact Message object appendRun receives.
    const sharedMessage = run.messages[0] as { id: string; content: string };
    store.appendRun("t1", run);

    expect(s.messagesSnapshot[0]!.id).toBe("r1-m");
    // Shallow copy: the stored element is the SAME object reference the caller passed.
    expect(s.messagesSnapshot[0]).toBe(sharedMessage);
  });

  it("run-cap eviction does NOT lose the thread message snapshot", () => {
    // R3-1: with maxRunsPerThread=1, appending a non-empty run then an empty
    // run FIFO-drops the first run. Pre-fix the snapshot lived on that dropped
    // run and getThreadMessages returned []. Now it lives on the thread.
    const store = new ɵBoundedThreadStore(limits({ maxRunsPerThread: 1 }));
    const s = store.getOrCreate("t1");
    store.appendRun("t1", makeRun("t1", "r1", { msgPad: 100 }));
    // Empty-snapshot run (error path / non-array agent.messages). makeRun always
    // yields 1 msg, so build the empty-snapshot run directly.
    const empty = makeRun("t1", "r2");
    empty.messages = [];
    store.appendRun("t1", empty);
    // r1 evicted by the run cap, r2 is the only stored run ...
    expect(store.peek("t1")!.historicRuns.map((r) => r.runId)).toEqual(["r2"]);
    // ... yet the thread snapshot survives (still the non-empty r1 snapshot).
    expect(s.messagesSnapshot.length).toBe(1);
    expect(s.messagesSnapshot[0]!.id).toBe("r1-m");
  });

  it("interleaved empty snapshot does NOT pin or double-count", () => {
    // R3-1: non-empty, empty, non-empty. The empty run must not pin an older
    // snapshot nor cause the thread to account two snapshots at once.
    const store = new ɵBoundedThreadStore(limits());
    const s = store.getOrCreate("t1");
    store.appendRun("t1", makeRun("t1", "r1", { msgPad: 1000 }));
    const empty = makeRun("t1", "r2");
    empty.messages = [];
    store.appendRun("t1", empty);
    store.appendRun("t1", makeRun("t1", "r3", { msgPad: 1000 }));
    // Latest non-empty snapshot wins.
    expect(s.messagesSnapshot[0]!.id).toBe("r3-m");
    // Only a SINGLE snapshot is accounted (no over-count from the pinned older
    // snapshot the pre-fix dedup would have left behind).
    const oneSnapshotBytes = ɵestimateBytes(s.messagesSnapshot);
    // Event bytes are tiny (eventPad=0 → ~1 event each). byteTotal must be close
    // to a single snapshot, never two.
    expect(store.byteTotal).toBeLessThan(oneSnapshotBytes * 2);
    expect(store.byteTotal).toBeGreaterThanOrEqual(oneSnapshotBytes);
  });

  it("tracks byteTotal and decrements it on run-cap eviction", () => {
    const store = new ɵBoundedThreadStore(limits({ maxRunsPerThread: 1 }));
    store.getOrCreate("t1");
    store.appendRun(
      "t1",
      makeRun("t1", "r1", { eventPad: 1000, msgPad: 1000 }),
    );
    const afterFirst = store.byteTotal;
    // One run's events + one thread snapshot.
    expect(afterFirst).toBeGreaterThan(2000);
    store.appendRun(
      "t1",
      makeRun("t1", "r2", { eventPad: 1000, msgPad: 1000 }),
    );
    // r1 evicted (cap 1); r2's events retained, thread snapshot replaced (not
    // added) so the total stays roughly one run's worth, not two.
    expect(store.peek("t1")!.historicRuns.map((r) => r.runId)).toEqual(["r2"]);
    expect(store.byteTotal).toBeLessThan(afterFirst + 500);
  });

  it("evicts OTHER LRU threads under the byte ceiling, not the just-appended one", () => {
    // maxBytes small enough that two fat runs cannot coexist.
    const store = new ɵBoundedThreadStore(
      limits({ maxBytes: 3000, maxThreads: 100 }),
    );
    store.getOrCreate("old");
    store.appendRun("old", makeRun("old", "r1", { eventPad: 2000 }));
    store.getOrCreate("new");
    store.appendRun("new", makeRun("new", "r1", { eventPad: 2000 })); // over ceiling → evict LRU "old"
    expect(store.peek("new")).toBeDefined();
    expect(store.peek("old")).toBeUndefined();
    expect(store.byteTotal).toBeLessThanOrEqual(3000 + 2100); // within one fat run of the ceiling
  });

  it("clear resets byteTotal", () => {
    const store = new ɵBoundedThreadStore(limits());
    store.getOrCreate("t1");
    store.appendRun("t1", makeRun("t1", "r1", { eventPad: 500 }));
    store.clear();
    expect(store.byteTotal).toBe(0);
  });
});

import { vi } from "vitest";

describe("ɵBoundedThreadStore — guidance log", () => {
  it("warns exactly once across many evictions, and again after clear", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const store = new ɵBoundedThreadStore(limits({ maxThreads: 1 }));
      store.getOrCreate("t1");
      store.getOrCreate("t2"); // evict t1 → warn #1
      store.getOrCreate("t3"); // evict t2 → no warn
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("Intelligence backend");

      store.clear();
      store.getOrCreate("a");
      store.getOrCreate("b"); // evict a → warn again after reset
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});
