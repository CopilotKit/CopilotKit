import { describe, expect, it } from "vitest";
import { classifyA2uiSurface } from "@/shell/canvas/canvas-context";
import { blockSurfaceIdFrom } from "./inline-block-surface";

const ops = (surfaceId: string) => ({
  a2ui_operations: [{ createSurface: { surfaceId }, version: "v1" }],
});

/** One op whose FIRST surface container is empty and whose second carries the id. */
const splitContainerOps = (surfaceId: string) => ({
  a2ui_operations: [{ createSurface: {}, updateComponents: { surfaceId } }],
});

describe("blockSurfaceIdFrom", () => {
  it("returns the id for block-prefixed surfaces", () =>
    expect(blockSurfaceIdFrom(ops("block:b1"))).toBe("block:b1"));
  it("returns null for report surfaces (canvas keeps them)", () =>
    expect(blockSurfaceIdFrom(ops("keel-ops-report-x1"))).toBeNull());
  it("returns null for malformed content", () =>
    expect(blockSurfaceIdFrom(undefined)).toBeNull());

  /**
   * `createSurface ?? updateComponents ?? updateDataModel` stops at the first
   * container that merely EXISTS, so an op carrying an empty `createSurface`
   * beside a real `updateComponents` read as "no block" — which is not "no
   * block", it is a block the shell then fails to route inline.
   */
  it("reads a LATER container when the first one has no surfaceId", () => {
    expect(blockSurfaceIdFrom(splitContainerOps("block:b1"))).toBe("block:b1");
    expect(
      blockSurfaceIdFrom(splitContainerOps("keel-ops-report-x1")),
    ).toBeNull();
  });

  /**
   * A non-string surfaceId used to reach `.startsWith` on a number and THROW,
   * mid-render, with no error boundary between this card and the transcript —
   * one drifted op unmounted the whole chat.
   */
  it("returns null for a non-string surfaceId instead of throwing", () => {
    expect(() =>
      blockSurfaceIdFrom({
        a2ui_operations: [{ createSurface: { surfaceId: 42 } }],
      }),
    ).not.toThrow();
    expect(
      blockSurfaceIdFrom({
        a2ui_operations: [{ createSurface: { surfaceId: 42 } }],
      }),
    ).toBeNull();
    expect(
      blockSurfaceIdFrom({ a2ui_operations: [{ createSurface: "block:b1" }] }),
    ).toBeNull();
  });

  /**
   * ONE HOME. This reader and the canvas's `classifyA2uiSurface` share a single
   * decision, so a list carrying BOTH a block surface and a report surface can
   * never render inline AND claim the canvas region — the canvas-biased side
   * wins and this reader stands down.
   */
  it("agrees with the canvas classifier on a mixed block+report op list", () => {
    const mixed = {
      a2ui_operations: [
        { createSurface: { surfaceId: "block:b1" } },
        { updateComponents: { surfaceId: "keel-ops-report-x1" } },
      ],
    };
    expect(classifyA2uiSurface(mixed)).toBe("canvas");
    expect(blockSurfaceIdFrom(mixed)).toBeNull();
  });

  /**
   * A STRINGIFIED envelope classifies (so a drifted block can never be mistaken
   * for a page-blanking report) but hands out no id: this card reads
   * `content["a2ui_operations"]` by property access and parses nothing, so an
   * id without readable ops would mount an empty card.
   */
  it("returns null for a stringified block envelope the card cannot read", () => {
    const stringified = JSON.stringify(ops("block:b1"));
    expect(classifyA2uiSurface(stringified)).toBe("inline-block");
    expect(blockSurfaceIdFrom(stringified)).toBeNull();
  });
});
