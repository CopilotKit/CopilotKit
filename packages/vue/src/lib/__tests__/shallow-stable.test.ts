import { describe, expect, it } from "vitest";
import { nextTick, shallowRef } from "vue";
import { useShallowStableRef } from "../shallow-stable";

/** A stable ref over a source the test replaces with `set(next)`. */
function stableOver<T>(initial: T) {
  const source = shallowRef(initial);
  const stable = useShallowStableRef(source);
  const set = async (next: T) => {
    source.value = next;
    await nextTick();
  };
  return { stable, set };
}

describe("useShallowStableRef", () => {
  it("keeps the reference for a shallowly equal plain object", async () => {
    const { stable, set } = stableOver({ a: 1 });
    const first = stable.value;

    await set({ a: 1 });

    expect(stable.value).toBe(first);
  });

  it("updates the reference when a value changes", async () => {
    const { stable, set } = stableOver({ a: 1 });

    await set({ a: 2 });

    expect(stable.value).toEqual({ a: 2 });
  });

  it("updates the reference when a different key holds undefined", async () => {
    const { stable, set } = stableOver<{ a?: number; b?: number }>({
      a: undefined,
    });
    const first = stable.value;

    await set({ b: undefined });

    expect(stable.value).not.toBe(first);
    expect(stable.value).toEqual({ b: undefined });
  });

  it("compares arrays by reference", async () => {
    const { stable, set } = stableOver([1, 2]);
    const first = stable.value;

    await set([1, 2]);

    expect(stable.value).not.toBe(first);
  });
});
