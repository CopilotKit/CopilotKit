import { describe, expect, it } from "vitest";
import { blockSurfaceIdFrom } from "./inline-block-surface";

const ops = (surfaceId: string) => ({
  a2ui_operations: [{ createSurface: { surfaceId }, version: "v1" }],
});

describe("blockSurfaceIdFrom", () => {
  it("returns the id for block-prefixed surfaces", () =>
    expect(blockSurfaceIdFrom(ops("block:b1"))).toBe("block:b1"));
  it("returns null for report surfaces (canvas keeps them)", () =>
    expect(blockSurfaceIdFrom(ops("keel-ops-report-x1"))).toBeNull());
  it("returns null for malformed content", () =>
    expect(blockSurfaceIdFrom(undefined)).toBeNull());
});
