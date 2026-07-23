import { describe, it, expect } from "vitest";
import { MemoryStore } from "./memory-store.js";
import { kvActionStore } from "./kv-action-store.js";

describe("kvActionStore", () => {
  it("put/get/delete a snapshot via state.kv", async () => {
    const state = new MemoryStore();
    const store = kvActionStore(state);
    const snap = {
      component: "Card",
      props: { x: 1 },
      path: [0, "onClick"],
      conversationKey: "c",
    };
    await store.put("ck:abc", snap);
    expect(await store.get("ck:abc")).toEqual(snap);
    // It is actually stored under the action: namespace in kv.
    expect(await state.kv.get("action:ck:abc")).toEqual(snap);
    await store.delete("ck:abc");
    expect(await store.get("ck:abc")).toBeUndefined();
  });
});
