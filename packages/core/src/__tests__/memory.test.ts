import { describe, expect, it } from "vitest";
import {
  ɵmemoryReducer as memoryReducer,
  ɵmemoryRestEvents as memoryRestEvents,
  ɵmemoryDomainEvents as memoryDomainEvents,
} from "../memory";
import type { ɵMemory as Memory } from "../memory";

function memory(id: string, content = `content-${id}`): Memory {
  return {
    id,
    kind: "topical",
    scope: "user",
    content,
    sourceThreadIds: [],
    invalidatedAt: null,
  };
}

describe("memory reducer", () => {
  it("populates memories from a snapshot for the matching session", () => {
    const next = memoryReducer(
      undefined,
      memoryRestEvents.listSucceeded({
        sessionId: 0,
        memories: [memory("m1"), memory("m2")],
      }),
    );

    expect(next.memories.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(next.isLoading).toBe(false);
    expect(next.error).toBeNull();
  });

  it("ignores a snapshot for a stale session", () => {
    const next = memoryReducer(
      undefined,
      memoryRestEvents.listSucceeded({
        sessionId: 99,
        memories: [memory("m1")],
      }),
    );

    expect(next.memories).toEqual([]);
  });

  it("prepends a newly created memory (newest first)", () => {
    const base = memoryReducer(
      undefined,
      memoryRestEvents.listSucceeded({ sessionId: 0, memories: [memory("m1")] }),
    );

    const next = memoryReducer(
      base,
      memoryDomainEvents.memoryUpserted({ sessionId: 0, memory: memory("m2") }),
    );

    expect(next.memories.map((m) => m.id)).toEqual(["m2", "m1"]);
  });

  it("replaces an existing memory in place on update", () => {
    const base = memoryReducer(
      undefined,
      memoryRestEvents.listSucceeded({
        sessionId: 0,
        memories: [memory("m1", "old"), memory("m2")],
      }),
    );

    const next = memoryReducer(
      base,
      memoryDomainEvents.memoryUpserted({
        sessionId: 0,
        memory: memory("m1", "new"),
      }),
    );

    expect(next.memories.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(next.memories[0]?.content).toBe("new");
  });

  it("removes a memory on invalidation", () => {
    const base = memoryReducer(
      undefined,
      memoryRestEvents.listSucceeded({
        sessionId: 0,
        memories: [memory("m1"), memory("m2")],
      }),
    );

    const next = memoryReducer(
      base,
      memoryDomainEvents.memoryInvalidated({ sessionId: 0, memoryId: "m1" }),
    );

    expect(next.memories.map((m) => m.id)).toEqual(["m2"]);
  });
});
