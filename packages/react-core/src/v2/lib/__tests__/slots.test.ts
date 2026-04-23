import { renderHook } from "../../../test-helpers/render-hook";
import { describe, it, expect } from "vitest";
import { useShallowStableRef } from "../slots";

describe("useShallowStableRef", () => {
  it("returns the same reference when called twice with shallowly equal plain objects", () => {
    const initial = { a: 1 };
    const { result, rerender } = renderHook(
      ({ value }: { value: { a: number } }) => useShallowStableRef(value),
      { initialProps: { value: initial } },
    );

    const firstRef = result.current;
    rerender({ value: { a: 1 } }); // new object, same shape
    expect(result.current).toBe(firstRef);
  });

  it("updates the reference when the value changes", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: { a: number } }) => useShallowStableRef(value),
      { initialProps: { value: { a: 1 } } },
    );

    const firstRef = result.current;
    rerender({ value: { a: 2 } });
    expect(result.current).not.toBe(firstRef);
    expect(result.current).toEqual({ a: 2 });
  });

  it("handles undefined without crashing", () => {
    const { result } = renderHook(() =>
      useShallowStableRef(undefined as unknown as { a: number }),
    );
    expect(result.current).toBeUndefined();
  });

  it("handles null without crashing", () => {
    const { result } = renderHook(() =>
      useShallowStableRef(null as unknown as { a: number }),
    );
    expect(result.current).toBeNull();
  });

  it("does not shallow-compare arrays — treats them by reference", () => {
    const arr1 = [1, 2, 3];
    const { result, rerender } = renderHook(
      ({ value }: { value: number[] }) => useShallowStableRef(value),
      { initialProps: { value: arr1 } },
    );

    const firstRef = result.current;
    rerender({ value: [1, 2, 3] }); // new array, same contents
    // arrays are not plain objects — reference should update
    expect(result.current).not.toBe(firstRef);
  });
});
