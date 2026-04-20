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
    expect(store.load("/ws/b.tsx", "useLangGraphInterrupt", null, 42)).toEqual({
      v: 1,
    });
  });

  it("reset clears a stored entry", async () => {
    const m = fakeMemento();
    const store = new HookControlsStore(m as any, "/ws");
    await store.save("/ws/a.tsx", "useCopilotAction", "x", { a: 1 });
    await store.reset("/ws/a.tsx", "useCopilotAction", "x");
    expect(store.load("/ws/a.tsx", "useCopilotAction", "x")).toBeUndefined();
  });

  it("reset on a non-existent key is a no-op (does not throw)", async () => {
    const store = new HookControlsStore(fakeMemento() as any, "/ws");
    await expect(
      store.reset("/ws/does-not-exist.tsx", "useCopilotAction", "nope"),
    ).resolves.toBeUndefined();
  });

  it("scopes entries by workspace root so two roots don't collide", async () => {
    const m = fakeMemento();
    const storeA = new HookControlsStore(m as any, "/workspace-a");
    const storeB = new HookControlsStore(m as any, "/workspace-b");
    await storeA.save("/file.tsx", "useCopilotAction", "x", { marker: "A" });
    await storeB.save("/file.tsx", "useCopilotAction", "x", { marker: "B" });
    expect(storeA.load("/file.tsx", "useCopilotAction", "x")).toEqual({
      marker: "A",
    });
    expect(storeB.load("/file.tsx", "useCopilotAction", "x")).toEqual({
      marker: "B",
    });
  });

  it("save overwrites a prior entry (does not merge)", async () => {
    const store = new HookControlsStore(fakeMemento() as any, "/ws");
    await store.save("/ws/a.tsx", "useCopilotAction", "x", { a: 1, b: 2 });
    await store.save("/ws/a.tsx", "useCopilotAction", "x", { a: 9 });
    expect(store.load("/ws/a.tsx", "useCopilotAction", "x")).toEqual({ a: 9 });
  });

  it("load rejects non-object values left in storage (e.g. hand-edited junk)", () => {
    const m = fakeMemento();
    // Bypass the store to plant a non-object value directly in the memento.
    void m.update(
      "copilotkit.hooks.controls::/ws::/ws/a.tsx::useCopilotAction::x",
      "scalar-junk",
    );
    const store = new HookControlsStore(m as any, "/ws");
    expect(store.load("/ws/a.tsx", "useCopilotAction", "x")).toBeUndefined();
  });
});
