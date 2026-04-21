import { describe, test, expect } from "@jest/globals";
import { InMemoryTipStore } from "../../src/tips/stores/in-memory.js";

describe("InMemoryTipStore", () => {
  test("load returns empty state initially", async () => {
    const store = new InMemoryTipStore();
    const state = await store.load();
    expect(state).toEqual({ shownTipIds: [] });
  });

  test("save persists state for subsequent load", async () => {
    const store = new InMemoryTipStore();
    await store.save({
      shownTipIds: ["tip-1", "tip-2"],
      lastShownAt: "2026-04-21T00:00:00.000Z",
    });
    const state = await store.load();
    expect(state.shownTipIds).toEqual(["tip-1", "tip-2"]);
    expect(state.lastShownAt).toBe("2026-04-21T00:00:00.000Z");
  });

  test("each instance has independent state", async () => {
    const store1 = new InMemoryTipStore();
    const store2 = new InMemoryTipStore();
    await store1.save({ shownTipIds: ["tip-1"] });
    const state2 = await store2.load();
    expect(state2.shownTipIds).toEqual([]);
  });
});
