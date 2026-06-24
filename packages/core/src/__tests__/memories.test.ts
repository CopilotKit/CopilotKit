import { describe, expect, it } from "vitest";
import { firstValueFrom } from "rxjs";
import { take, toArray } from "rxjs/operators";
import {
  ɵcreateMemoryStore,
  ɵselectMemories,
  ɵselectMemoriesError,
  ɵselectMemoriesIsLoading,
} from "../memories";
import type { PublicMemory } from "../memories";

const sampleMemory: PublicMemory = {
  id: "mem-seed",
  kind: "topical",
  scope: "user",
  content: "User prefers dark mode",
  sourceThreadIds: ["thread-1"],
  invalidatedAt: null,
};

describe("ɵcreateMemoryStore", () => {
  it("starts empty with no error and not loading", () => {
    const store = ɵcreateMemoryStore();

    expect(store.getState().memories).toEqual([]);
    expect(store.getState().isLoading).toBe(false);
    expect(store.getState().error).toBeNull();
  });

  it("seeds the list from initial memories", () => {
    const store = ɵcreateMemoryStore({ initial: [sampleMemory] });

    expect(store.getState().memories).toEqual([sampleMemory]);
  });

  it("addMemory inserts the created memory and resolves to it", async () => {
    const store = ɵcreateMemoryStore({
      idFactory: () => "mem-created",
    });

    const created = await store.addMemory({
      kind: "episodic",
      scope: "user",
      content: "Met with Acme on Tuesday",
      sourceThreadIds: ["thread-7"],
    });

    expect(created.id).toBe("mem-created");
    expect(created.content).toBe("Met with Acme on Tuesday");
    expect(store.getState().memories).toContainEqual(created);
  });

  it("updateMemory supersedes: new id minted, old id removed, change applied", async () => {
    let next = 0;
    const store = ɵcreateMemoryStore({
      initial: [sampleMemory],
      idFactory: () => `mem-superseded-${(next += 1)}`,
    });

    const updated = await store.updateMemory("mem-seed", {
      content: "User prefers light mode",
    });

    expect(updated.id).not.toBe("mem-seed");
    expect(updated.content).toBe("User prefers light mode");
    const ids = store.getState().memories.map((m) => m.id);
    expect(ids).not.toContain("mem-seed");
    expect(ids).toContain(updated.id);
  });

  it("updateMemory preserves untouched fields onto the superseded memory", async () => {
    const store = ɵcreateMemoryStore({
      initial: [sampleMemory],
      idFactory: () => "mem-next",
    });

    const updated = await store.updateMemory("mem-seed", {
      content: "changed",
    });

    expect(updated.kind).toBe("topical");
    expect(updated.scope).toBe("user");
    expect(updated.sourceThreadIds).toEqual(["thread-1"]);
  });

  it("updateMemory rejects with MEMORY_NOT_FOUND for an unknown id", async () => {
    const store = ɵcreateMemoryStore();

    await expect(store.updateMemory("nope", { content: "x" })).rejects.toThrow(
      "MEMORY_NOT_FOUND",
    );
  });

  it("removeMemory removes the memory from the list", async () => {
    const store = ɵcreateMemoryStore({ initial: [sampleMemory] });

    await store.removeMemory("mem-seed");

    expect(store.getState().memories).toEqual([]);
  });

  it("ɵselectMemories emits the updated list after a mutation", async () => {
    const store = ɵcreateMemoryStore({
      idFactory: () => "mem-rt",
    });

    const emissions = firstValueFrom(
      store.select(ɵselectMemories).pipe(take(2), toArray()),
    );

    await store.addMemory({
      kind: "operational",
      scope: "project",
      content: "Deploy via the staging pipeline",
    });

    const emitted = await emissions;
    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toEqual([]);
    expect(emitted[1]!.map((m) => m.id)).toEqual(["mem-rt"]);
  });

  it("applies an externally emitted created event (realtime reconciliation)", () => {
    const store = ɵcreateMemoryStore();

    store.ɵemitMetadataEvent({ operation: "created", memory: sampleMemory });

    expect(store.getState().memories).toContainEqual(sampleMemory);
  });

  it("applies an externally emitted invalidated event", () => {
    const store = ɵcreateMemoryStore({ initial: [sampleMemory] });

    store.ɵemitMetadataEvent({
      operation: "invalidated",
      memoryId: "mem-seed",
    });

    expect(store.getState().memories).toEqual([]);
  });

  it("exposes loading and error via selectors", async () => {
    const store = ɵcreateMemoryStore();

    expect(await firstValueFrom(store.select(ɵselectMemoriesIsLoading))).toBe(
      false,
    );
    expect(await firstValueFrom(store.select(ɵselectMemoriesError))).toBeNull();
  });
});
