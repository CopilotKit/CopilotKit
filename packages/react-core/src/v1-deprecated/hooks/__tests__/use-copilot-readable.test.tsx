import { vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCopilotReadable } from "../use-copilot-readable";

type Availability = "enabled" | "disabled";

interface FakeContextEntry {
  description: string;
  value: string;
}

/**
 * Mirrors the semantics of `ContextStore` in @copilotkit/core: `addContext`
 * assigns a fresh id and stores the *already serialized* value, `removeContext`
 * deletes by id. Using a fake keeps these tests focused on the hook's effect
 * logic, which is where every one of these regressions lived.
 */
function createFakeCopilotKit() {
  const store: Record<string, FakeContextEntry> = {};
  let nextId = 0;

  return {
    get context() {
      return store;
    },
    addContext: vi.fn((entry: FakeContextEntry) => {
      const id = `ctx-${++nextId}`;
      store[id] = { ...entry };
      return id;
    }),
    removeContext: vi.fn((id: string) => {
      delete store[id];
    }),
    entries: () => Object.values(store),
    ids: () => Object.keys(store),
  };
}

let fake: ReturnType<typeof createFakeCopilotKit>;

vi.mock("../../../v2", () => ({
  useCopilotKit: () => ({ copilotkit: fake }),
}));

// Stable across renders so that re-render assertions measure the dependency
// array, not the identity churn of an inline literal.
const EMPLOYEES = [{ name: "Jane" }, { name: "Sam" }];

describe("useCopilotReadable", () => {
  beforeEach(() => {
    fake = createFakeCopilotKit();
  });

  it("registers the context on mount", () => {
    renderHook(() =>
      useCopilotReadable({ description: "employees", value: EMPLOYEES }),
    );

    expect(fake.addContext).toHaveBeenCalledTimes(1);
    expect(fake.entries()).toEqual([
      { description: "employees", value: JSON.stringify(EMPLOYEES) },
    ]);
  });

  it("removes the context on unmount", () => {
    const { unmount } = renderHook(() =>
      useCopilotReadable({ description: "employees", value: EMPLOYEES }),
    );
    const [id] = fake.ids();

    unmount();

    expect(fake.removeContext).toHaveBeenCalledWith(id);
    expect(fake.entries()).toEqual([]);
  });

  describe("available", () => {
    it("registers nothing when mounted as disabled", () => {
      renderHook(() =>
        useCopilotReadable({
          description: "employees",
          value: EMPLOYEES,
          available: "disabled",
        }),
      );

      expect(fake.addContext).not.toHaveBeenCalled();
      expect(fake.entries()).toEqual([]);
    });

    // Regression: `available` was missing from the effect's dependency array,
    // so flipping it after mount was a no-op.
    it("removes the context when flipped to disabled after mount", () => {
      const { rerender } = renderHook(
        ({ available }: { available: Availability }) =>
          useCopilotReadable({
            description: "employees",
            value: EMPLOYEES,
            available,
          }),
        { initialProps: { available: "enabled" as Availability } },
      );

      expect(fake.entries()).toHaveLength(1);

      rerender({ available: "disabled" });

      expect(fake.entries()).toEqual([]);
    });

    it("re-adds the context when flipped back to enabled", () => {
      const { rerender } = renderHook(
        ({ available }: { available: Availability }) =>
          useCopilotReadable({
            description: "employees",
            value: EMPLOYEES,
            available,
          }),
        { initialProps: { available: "disabled" as Availability } },
      );

      expect(fake.entries()).toEqual([]);

      rerender({ available: "enabled" });

      expect(fake.entries()).toEqual([
        { description: "employees", value: JSON.stringify(EMPLOYEES) },
      ]);
    });
  });

  describe("convert", () => {
    // Regression: convert was invoked as `convert(value)`, so a user's function
    // received the value as `description` and `undefined` as `value`.
    it("is called with (description, value) in that order", () => {
      const convert = vi.fn(() => "converted");

      renderHook(() =>
        useCopilotReadable({
          description: "employees",
          value: EMPLOYEES,
          convert,
        }),
      );

      expect(convert).toHaveBeenCalledTimes(1);
      expect(convert).toHaveBeenCalledWith("employees", EMPLOYEES);
    });

    it("is used in place of JSON.stringify", () => {
      const convert = vi.fn(
        (description: string, value: typeof EMPLOYEES) =>
          `${description}: ${value.map((e) => e.name).join(", ")}`,
      );

      renderHook(() =>
        useCopilotReadable({
          description: "employees",
          value: EMPLOYEES,
          convert,
        }),
      );

      expect(fake.entries()).toEqual([
        { description: "employees", value: "employees: Jane, Sam" },
      ]);
    });

    // Guards the fix itself: `JSON.stringify` must never receive the
    // description as a first argument, because its second parameter is a
    // replacer. `JSON.stringify("employees", EMPLOYEES)` would yield
    // `"\"employees\""` rather than the serialized value.
    it("serializes the value alone when convert is omitted", () => {
      renderHook(() =>
        useCopilotReadable({ description: "employees", value: EMPLOYEES }),
      );

      expect(fake.entries()[0]!.value).toBe(JSON.stringify(EMPLOYEES));
      expect(fake.entries()[0]!.value).not.toBe(JSON.stringify("employees"));
    });
  });

  describe("dependencies", () => {
    // Regression: the `dependencies` argument was accepted but never reached
    // the effect's dependency array.
    it("re-runs the effect when a dependency changes", () => {
      const { rerender } = renderHook(
        ({ dep }: { dep: number }) =>
          useCopilotReadable({ description: "employees", value: EMPLOYEES }, [
            dep,
          ]),
        { initialProps: { dep: 1 } },
      );

      expect(fake.addContext).toHaveBeenCalledTimes(1);
      const [firstId] = fake.ids();

      rerender({ dep: 2 });

      expect(fake.addContext).toHaveBeenCalledTimes(2);
      expect(fake.removeContext).toHaveBeenCalledWith(firstId);
      // The stale entry is replaced, not accumulated.
      expect(fake.entries()).toHaveLength(1);
    });

    it("does not re-run the effect when the dependency is unchanged", () => {
      const { rerender } = renderHook(
        ({ dep }: { dep: number }) =>
          useCopilotReadable({ description: "employees", value: EMPLOYEES }, [
            dep,
          ]),
        { initialProps: { dep: 1 } },
      );

      rerender({ dep: 1 });

      expect(fake.addContext).toHaveBeenCalledTimes(1);
      expect(fake.removeContext).not.toHaveBeenCalled();
    });
  });

  it("re-registers when the description changes", () => {
    const { rerender } = renderHook(
      ({ description }: { description: string }) =>
        useCopilotReadable({ description, value: EMPLOYEES }),
      { initialProps: { description: "employees" } },
    );

    rerender({ description: "staff" });

    expect(fake.entries()).toEqual([
      { description: "staff", value: JSON.stringify(EMPLOYEES) },
    ]);
  });

  // Two components publishing identical readables must each own their entry.
  // A dedup that reused an existing id would make the first unmount delete the
  // entry the second component is still relying on.
  it("keeps separate entries for identical readables in two components", () => {
    const first = renderHook(() =>
      useCopilotReadable({ description: "employees", value: EMPLOYEES }),
    );
    const second = renderHook(() =>
      useCopilotReadable({ description: "employees", value: EMPLOYEES }),
    );

    expect(fake.entries()).toHaveLength(2);

    first.unmount();

    expect(fake.entries()).toEqual([
      { description: "employees", value: JSON.stringify(EMPLOYEES) },
    ]);

    second.unmount();

    expect(fake.entries()).toEqual([]);
  });
});
