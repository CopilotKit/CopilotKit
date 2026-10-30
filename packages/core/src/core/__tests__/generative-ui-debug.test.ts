import { describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
import type { ɵGenerativeUIDebugSource } from "../generative-ui-debug";

const source = (): ɵGenerativeUIDebugSource => ({
  getSnapshot: vi.fn(),
  subscribe: () => () => {},
});

describe("generative UI debug source", () => {
  it("stores the source and tells listeners only when it changes", () => {
    const core = new CopilotKitCore({});
    const listener = vi.fn();
    const unsubscribe = core.ɵsubscribeToGenerativeUIDebugSource(listener);
    const first = source();

    core.ɵsetGenerativeUIDebugSource(first);
    core.ɵsetGenerativeUIDebugSource(first);
    expect(core.ɵgenerativeUIDebugSource).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);

    core.ɵsetGenerativeUIDebugSource(undefined);
    expect(core.ɵgenerativeUIDebugSource).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    core.ɵsetGenerativeUIDebugSource(source());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps calling listeners after one throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const core = new CopilotKitCore({});
    const after = vi.fn();
    core.ɵsubscribeToGenerativeUIDebugSource(() => {
      throw new Error("boom");
    });
    core.ɵsubscribeToGenerativeUIDebugSource(after);

    core.ɵsetGenerativeUIDebugSource(source());

    expect(after).toHaveBeenCalledTimes(1);
  });
});
