import { describe, it, expect } from "vitest";
import { HookControlsStore } from "../persistence";

const fakeMemento = () => {
  const m = new Map<string, unknown>();
  return {
    get: <T>(key: string, def?: T): T | undefined =>
      m.has(key) ? (m.get(key) as T) : def,
    update: async (key: string, value: unknown) => {
      if (value === undefined) m.delete(key);
      else m.set(key, value);
    },
    keys: () => [...m.keys()],
  };
};

describe("HookControlsStore", () => {
  it("stores and reads values by workspace/file/hook/name", async () => {
    const store = new HookControlsStore(fakeMemento() as any, "/ws");
    await store.save("/ws/a.tsx", "useCopilotAction", "addTodo", {
      args: { text: "hi" },
    });
    expect(store.load("/ws/a.tsx", "useCopilotAction", "addTodo")).toEqual({
      args: { text: "hi" },
    });
  });

  it("uses file:line when name is null", async () => {
    const store = new HookControlsStore(fakeMemento() as any, "/ws");
    await store.save("/ws/b.tsx", "useLangGraphInterrupt", null, { v: 1 }, 42);
    expect(
      store.load("/ws/b.tsx", "useLangGraphInterrupt", null, 42),
    ).toEqual({ v: 1 });
  });

  it("reset clears a stored entry", async () => {
    const m = fakeMemento();
    const store = new HookControlsStore(m as any, "/ws");
    await store.save("/ws/a.tsx", "useCopilotAction", "x", { a: 1 });
    await store.reset("/ws/a.tsx", "useCopilotAction", "x");
    expect(store.load("/ws/a.tsx", "useCopilotAction", "x")).toBeUndefined();
  });
});
