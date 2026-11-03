import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { A2UISurfaceDiagnostics } from "../surface-diagnostics";
import type { A2UISurfaceLookup } from "../surface-diagnostics";

const components = (ids: string[]) => ({
  version: "v0.9",
  updateComponents: {
    surfaceId: "s",
    components: ids.map((id) => ({ id, component: "Text" })),
  },
});

/** A model holding surface "s" with the given component ids, or no surface. */
function modelWith(ids: string[] | null): A2UISurfaceLookup {
  return {
    getSurface: (surfaceId) =>
      ids && surfaceId === "s"
        ? {
            componentsModel: {
              get: (id: string) => ids.includes(id) || undefined,
            },
          }
        : undefined,
  };
}

describe("A2UISurfaceDiagnostics", () => {
  const warn = vi.fn<(message: string) => void>();
  let diagnostics: A2UISurfaceDiagnostics;

  beforeEach(() => {
    vi.useFakeTimers();
    warn.mockReset();
    diagnostics = new A2UISurfaceDiagnostics({ warn });
  });
  afterEach(() => {
    diagnostics.dispose();
    vi.useRealTimers();
  });

  it("warns when a surface's root is still missing 8s after the last check", () => {
    diagnostics.check([components(["card"])], modelWith(["card"]));
    vi.advanceTimersByTime(7999);
    expect(warn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain('has no "root" component');
  });

  it("re-arms on every check, so only the last snapshot is diagnosed", () => {
    diagnostics.check([components(["card"])], modelWith(["card"]));
    vi.advanceTimersByTime(5000);
    diagnostics.check([components(["root"])], modelWith(["root"]));
    vi.advanceTimersByTime(8000);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns a task later about a surface that was never created", () => {
    diagnostics.check([components(["root"])], modelWith(null));
    vi.advanceTimersByTime(0);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain("no surface by that id exists");
  });

  it("does not report a surface the operations deleted", () => {
    diagnostics.check(
      [{ version: "v0.9", deleteSurface: { surfaceId: "s" } }],
      modelWith(null),
    );
    vi.advanceTimersByTime(8000);
    expect(warn).not.toHaveBeenCalled();
  });

  it("cancels pending checks on dispose", () => {
    diagnostics.check([components(["card"])], modelWith(["card"]));
    diagnostics.dispose();
    vi.advanceTimersByTime(8000);
    expect(warn).not.toHaveBeenCalled();
  });
});
