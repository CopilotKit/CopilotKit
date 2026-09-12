/**
 * Regression test for `useBlockData`'s no-provider fallback.
 *
 * WHAT THIS GUARDS: a block renderer mounted outside `BlockDataProvider`
 * (shouldn't happen in the canvas, but the fallback exists for exactly that
 * case) used to have `addBlock` resolve silently. `AddToDashboard`
 * (`./catalog/renderers.tsx`) awaits `addBlock` and, on success, renders
 * "Pinned ✓" — so a pin attempted with no provider mounted reported success
 * for a pin that never happened. `addBlock` must REJECT instead, so that
 * control's existing error path renders the failure loudly.
 */

import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBlockData } from "./block-data";

describe("useBlockData outside BlockDataProvider", () => {
  it("rejects addBlock with a clear error instead of resolving silently", async () => {
    const { result } = renderHook(() => useBlockData());
    await expect(result.current.addBlock("ceo", "block-1")).rejects.toThrow(
      /BlockDataProvider is not mounted/,
    );
  });

  it("still returns read-only fallbacks: an empty snapshot and isPinned() === false", () => {
    const { result } = renderHook(() => useBlockData());
    expect(result.current.isPinned("anything")).toBe(false);
    expect(result.current.snapshot.dashboards.ceo.blocks).toEqual([]);
    expect(result.current.snapshot.dashboards.cfo.blocks).toEqual([]);
  });
});
