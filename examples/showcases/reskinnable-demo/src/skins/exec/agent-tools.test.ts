import { beforeEach, describe, expect, it } from "vitest";
import {
  renderMetricBlockTool,
  publishBoardPackTool,
} from "@/skins/exec/agent";
import * as store from "@/skins/exec/data/store";
import {
  A2UI_OPERATIONS_KEY,
  BLOCK_SURFACE_PREFIX,
  extractSurfaceId,
} from "@/skins/exec/blocks/build-block-ops";

/**
 * THE TWO THINGS `agent.ts` HAS TO GET RIGHT ON ITS OWN, NOT BY INHERITING
 * FROM `buildBlockOps`/`store.publishPack` (which already have their own
 * tests): the SHAPE it hands back across the tool boundary.
 *
 * `render_metric_block` is the ONLY tool that puts a chat-composed block on
 * screen — an agent that calls it and gets ops keyed wrong, or a surface id
 * that is not a BLOCK id, is indistinguishable on stage from a model that
 * declined to render anything. And a block the tool forgot to register as a
 * draft (`store.createDraftBlock`) is a block "Add to dashboard" can never
 * find, which fails silently a step later, on a different screen.
 *
 * `publish_board_pack` is the beat-6 gate: the agent has to be able to read
 * `UNEXPLAINED_VARIANCE` and its `breaches` back VERBATIM, because the whole
 * teach arc (offerWorkflowRecording → awaitDemonstration →
 * saveLearnedProcedure) only fires if the agent actually sees the refusal
 * rather than a swallowed or reshaped error.
 *
 * Written against keel's `agent.test.ts` pattern of importing `defineTool`
 * consts directly and invoking `.execute` — but importing the tool consts
 * themselves (per the plan's Task 8 note), not extracting them from the
 * agent factory's `config.tools`, since this suite exists to pin the
 * export surface `agent.ts` has not been written yet.
 */

beforeEach(() => store.reset());

describe("render_metric_block", () => {
  it("emits a2ui ops on a block: surface, files a draft, and grows NO dashboard", async () => {
    const before = {
      ceo: store.snapshot().dashboards.ceo.blocks.length,
      cfo: store.snapshot().dashboards.cfo.blocks.length,
    };

    const result = (await renderMetricBlockTool.execute!({
      kind: "metricTile",
      title: "Revenue vs Plan",
      metricId: "revenue",
      department: "all",
      compare: "plan",
    })) as Record<string, unknown>;

    const ops = result[A2UI_OPERATIONS_KEY] as
      | Record<string, unknown>[]
      | undefined;
    expect(
      ops,
      `expected the tool to key its result "${A2UI_OPERATIONS_KEY}"`,
    ).toBeDefined();

    const surfaceId = extractSurfaceId(ops!) ?? "";
    expect(surfaceId.startsWith(BLOCK_SURFACE_PREFIX)).toBe(true);

    // NO dashboard grew — a rendered block is a draft, not a pin.
    const after = store.snapshot().dashboards;
    expect(after.ceo.blocks.length).toBe(before.ceo);
    expect(after.cfo.blocks.length).toBe(before.cfo);

    // A matching draft exists: `addBlockToDashboard` only succeeds against a
    // real draft id (it throws NOT_FOUND otherwise) — that success IS the
    // proof, since the store keeps no other way to read the drafts map.
    const blockId = surfaceId.slice(BLOCK_SURFACE_PREFIX.length);
    const pinned = store.addBlockToDashboard("cfo", blockId);
    expect(pinned.id).toBe(blockId);
    expect(pinned.spec.metricId).toBe("revenue");
  });
});

describe("publish_board_pack", () => {
  it("propagates the seeded CFO dashboard's UNEXPLAINED_VARIANCE gate verbatim", async () => {
    // Independent oracle call, same seed, same (unexplained) PIN-correct
    // path: the store's own gate never mutates state on the 422 branch, so
    // calling it here and again through the tool below both read the same
    // seeded, unexplained opex/distribution breach.
    const gate = store.publishPack("cfo", store.COUNTERSIGN_PIN);
    expect(
      gate.ok,
      "fixture assumption broken: seeded cfo dashboard no longer breaches",
    ).toBe(false);
    if (gate.ok || gate.code !== "UNEXPLAINED_VARIANCE") {
      throw new Error(
        "fixture assumption broken: seeded cfo dashboard no longer breaches UNEXPLAINED_VARIANCE",
      );
    }

    const result = (await publishBoardPackTool.execute!({
      dashboardId: "cfo",
      countersignPin: store.COUNTERSIGN_PIN,
    })) as Record<string, unknown>;

    // VERBATIM: the agent must be able to read the gate back, not a
    // reshaped or summarized version of it.
    expect(result).toEqual({
      error: "UNEXPLAINED_VARIANCE",
      breaches: gate.breaches,
    });

    // And the breach the gate names is the real, unexplained seeded one —
    // not an empty or unrelated decoy array that happened to satisfy toEqual.
    const breaches = result.breaches as
      | { metricId: string; explained: boolean }[]
      | undefined;
    expect(
      breaches?.some((b) => b.metricId === "opex" && b.explained === false),
    ).toBe(true);
  });
});
