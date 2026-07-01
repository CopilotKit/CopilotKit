import { describe, it, expect } from "vitest";
import { surfaceBus } from "./surface-bus";

describe("surfaceBus", () => {
  it("tracks surfaceId from createSurface and notifies subscribers with the tail", () => {
    const channel = "t1";
    const seen: number[] = [];
    const unsub = surfaceBus.subscribe(channel, (snap) => seen.push(snap.ops.length));

    surfaceBus.push(channel, [{ createSurface: { surfaceId: "s1" } }]);
    surfaceBus.push(channel, [{ updateComponents: { surfaceId: "s1" } }]);

    expect(surfaceBus.snapshot(channel).surfaceId).toBe("s1");
    expect(surfaceBus.snapshot(channel).ops).toHaveLength(2);
    expect(seen).toEqual([1, 2]);
    unsub();
  });

  it("reset clears ops and surfaceId", () => {
    const channel = "t2";
    surfaceBus.push(channel, [{ createSurface: { surfaceId: "s2" } }]);
    surfaceBus.reset(channel);
    expect(surfaceBus.snapshot(channel)).toEqual({ surfaceId: null, ops: [] });
  });
});
