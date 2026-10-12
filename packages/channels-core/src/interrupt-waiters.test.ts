import { describe, expect, it } from "vitest";
import { MemoryStore } from "./state/memory-store.js";
import {
  addInterruptWaiter,
  listInterruptWaiters,
  removeInterruptWaiter,
} from "./interrupt-waiters.js";

describe("interrupt waiters", () => {
  it("round-trips a waiter on the state store", async () => {
    const state = new MemoryStore();
    await addInterruptWaiter(state, "conv-1", "billing");
    expect(await listInterruptWaiters(state, "conv-1")).toEqual(["billing"]);
  });

  it("keeps two waiters and removes one", async () => {
    const state = new MemoryStore();
    await addInterruptWaiter(state, "conv-1", "default");
    await addInterruptWaiter(state, "conv-1", "billing");
    await removeInterruptWaiter(state, "conv-1", "default");
    expect(await listInterruptWaiters(state, "conv-1")).toEqual(["billing"]);
  });

  it("keeps waiters isolated per conversationKey", async () => {
    const state = new MemoryStore();
    await addInterruptWaiter(state, "conv-1", "billing");
    await addInterruptWaiter(state, "conv-2", "default");
    expect(await listInterruptWaiters(state, "conv-1")).toEqual(["billing"]);
    expect(await listInterruptWaiters(state, "conv-2")).toEqual(["default"]);
  });

  it("lists nothing after the last waiter is removed, and a missing remove is a no-op", async () => {
    const state = new MemoryStore();
    await addInterruptWaiter(state, "conv-1", "billing");
    await removeInterruptWaiter(state, "conv-1", "billing");
    expect(await listInterruptWaiters(state, "conv-1")).toEqual([]);
    expect(await state.kv.get("interrupt:conv-1")).toBeUndefined();
    await removeInterruptWaiter(state, "conv-1", "missing");
    expect(await listInterruptWaiters(state, "conv-1")).toEqual([]);
  });
});
