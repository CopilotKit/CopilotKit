import { beforeEach, describe, expect, it } from "vitest";
import {
  renderMetricBlockTool,
  publishBoardPackTool,
  fileVarianceNarrativeTool,
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
 * `publish_board_pack` is the beat-6 gate. It is EXPORTED BUT NOT REGISTERED
 * (see its doc comment in `agent.ts`) — the countersign card is the agent's
 * only publish path — so this suite is the only caller of its `execute`, and
 * that is exactly what it is for: the refusal shape has to read back
 * `UNEXPLAINED_VARIANCE` and its `breaches` VERBATIM, because the whole
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

  /**
   * The pin handle. `pinBlockToDashboard` (`./tools.tsx`) is the agent's route
   * to the same write "Add to dashboard" performs, and the ONLY id it accepts
   * is the one this result carries — an agent that cannot read a `blockId` off
   * the render result cannot execute beat 5's step 4 at all, and would have to
   * guess an id `addBlockToDashboard` throws NOT_FOUND on.
   */
  it("returns a blockId that store.addBlockToDashboard accepts", async () => {
    const result = (await renderMetricBlockTool.execute!({
      kind: "trendLine",
      title: "Burn rate trend",
      metricId: "burnRate",
      department: "all",
      months: 12,
    })) as Record<string, unknown>;

    const blockId = result.blockId;
    expect(typeof blockId, "the pin needs a string blockId").toBe("string");

    // The surface id and the pin handle are the SAME block — two ids here
    // would pin something other than what the transcript is showing.
    const ops = result[A2UI_OPERATIONS_KEY] as Record<string, unknown>[];
    expect(extractSurfaceId(ops)).toBe(`${BLOCK_SURFACE_PREFIX}${blockId}`);

    const pinned = store.addBlockToDashboard("ceo", blockId as string);
    expect(pinned.id).toBe(blockId);
    expect(store.snapshot().dashboards.ceo.blocks.map((b) => b.id)).toContain(
      blockId,
    );
  });
});

/**
 * `file_variance_narrative` calls `store.fileNarrative` DIRECTLY (see
 * `agent.ts`'s doc comment above `PERIOD_RE`) — it never goes through the
 * REST route (`src/app/api/exec/v1/narratives/route.ts`), so that route's
 * zod validation buys this tool nothing. It needs, and has, its own guards
 * for the same two silent-demo-killers: a mistyped period that files a
 * narrative matching no breach, and an empty body that flips `explained` on
 * nothing. Both refusals must stay CODE-FREE, same as `BAD_CODE` above.
 */
describe("file_variance_narrative", () => {
  const VALID_ARGS = {
    metricId: "opex" as const,
    period: "2024-06",
    code: "VAR-TIMING",
    body: "Shipment timing shift pushed the spend into this period.",
  };

  const WITHHELD_CODES = ["VAR-TIMING", "VAR-ONEOFF", "VAR-FX", "VAR-PLAN"];

  it("refuses a malformed period and names no code — the store gains no narrative", async () => {
    const before = store.snapshot().narratives.length;
    const result = (await fileVarianceNarrativeTool.execute!({
      ...VALID_ARGS,
      period: "2024-6",
    })) as Record<string, unknown>;

    expect(result.error).toBe("BAD_PERIOD");
    const text = JSON.stringify(result);
    for (const code of WITHHELD_CODES) {
      expect(text).not.toContain(code);
    }
    expect(store.snapshot().narratives.length).toBe(before);
  });

  it("refuses a whitespace-only body and names no code — the store gains no narrative", async () => {
    const before = store.snapshot().narratives.length;
    const result = (await fileVarianceNarrativeTool.execute!({
      ...VALID_ARGS,
      body: "   ",
    })) as Record<string, unknown>;

    expect(result.error).toBe("EMPTY_BODY");
    const text = JSON.stringify(result);
    for (const code of WITHHELD_CODES) {
      expect(text).not.toContain(code);
    }
    expect(store.snapshot().narratives.length).toBe(before);
  });

  it("files a valid narrative with the body trimmed", async () => {
    const result = (await fileVarianceNarrativeTool.execute!({
      ...VALID_ARGS,
      body: "  Shipment timing shift.  ",
    })) as Record<string, unknown>;

    const narrative = result.narrative as { body: string } | undefined;
    expect(narrative?.body).toBe("Shipment timing shift.");
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
