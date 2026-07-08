import { describe, it, expect } from "vitest";
import { InMemoryHistoryStore } from "./history-store.js";

describe("InMemoryHistoryStore", () => {
  it("appends and reads back per conversation in order", async () => {
    const store = new InMemoryHistoryStore();
    await store.append("c1", { role: "user", content: "hi", ts: "1" });
    await store.append("c1", { role: "assistant", content: "hello", ts: "2" });
    await store.append("c2", { role: "user", content: "other", ts: "3" });

    expect(await store.read("c1")).toEqual([
      { role: "user", content: "hi", ts: "1" },
      { role: "assistant", content: "hello", ts: "2" },
    ]);
    expect(await store.read("c2")).toHaveLength(1);
    expect(await store.read("missing")).toEqual([]);
  });

  it("caps stored history to maxMessages (drops oldest)", async () => {
    const store = new InMemoryHistoryStore({ maxMessages: 2 });
    await store.append("c", { role: "user", content: "a", ts: "1" });
    await store.append("c", { role: "assistant", content: "b", ts: "2" });
    await store.append("c", { role: "user", content: "c", ts: "3" });
    const out = await store.read("c");
    expect(out.map((m) => m.content)).toEqual(["b", "c"]);
  });
});
