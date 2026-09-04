import { describe, expect, it } from "vitest";
import {
  buildBlockOps,
  extractSurfaceId,
  isBlockSurfaceId,
  BLOCK_SURFACE_PREFIX,
} from "./build-block-ops";
import type { BlockSpec } from "../data/types";

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

  /**
   * `buildKindComponent` forwards `metricId` unguarded for the three
   * metric-bound kinds — a spec missing it would otherwise reach the client
   * as `metricId: undefined` on a REQUIRED catalog prop: a tile bound to
   * nothing, rendering blank with no error anywhere. `render_metric_block`'s
   * `execute` guard (agent.ts) catches this before it ever calls in for the
   * agent's own path, but `buildBlockOps` is also called from the ledger GET
   * route rebuilding ops for every PINNED block — a bad stored spec must
   * fail loud here too, not emit junk.
   */
  it("throws METRIC_ID_REQUIRED for a metric-bound kind without metricId", () => {
    const missingMetricId = {
      kind: "metricTile",
      title: "Revenue vs plan",
    } as BlockSpec;
    expect(() => buildBlockOps(missingMetricId, "b1")).toThrow(
      /^METRIC_ID_REQUIRED/,
    );
  });

  it("throws for a kind outside the BlockKind union instead of silently emitting undefined", () => {
    const unknownKind = {
      kind: "bogusKind",
      title: "Whatever",
    } as unknown as BlockSpec;
    expect(() => buildBlockOps(unknownKind, "b1")).toThrow(
      /^UNKNOWN_BLOCK_KIND/,
    );
  });
});
