import { describe, expect, it } from "vitest";
import {
  buildBlockOps,
  extractSurfaceId,
  isBlockSurfaceId,
  BLOCK_SURFACE_PREFIX,
} from "./build-block-ops";

const spec = {
  kind: "metricTile",
  title: "Revenue vs plan",
  metricId: "revenue",
  compare: "plan",
} as const;

describe("buildBlockOps", () => {
  it("targets a block-prefixed surface id extractable from the ops", () => {
    const ops = buildBlockOps(spec, "b1");
    const id = extractSurfaceId(ops);
    expect(id).toBe(`${BLOCK_SURFACE_PREFIX}b1`);
    expect(isBlockSurfaceId(id)).toBe(true);
  });
  it("includes an AddToDashboard node for drafts and omits it when pinned", () => {
    const draft = JSON.stringify(buildBlockOps(spec, "b1"));
    const pinned = JSON.stringify(buildBlockOps(spec, "b1", { pinned: true }));
    expect(draft).toContain("AddToDashboard");
    expect(pinned).not.toContain("AddToDashboard");
  });
  it("never embeds numbers — data binds live on the client", () => {
    expect(JSON.stringify(buildBlockOps(spec, "b1"))).not.toMatch(
      /"(plan|actual|forecast)":\s*\d/,
    );
  });
});
