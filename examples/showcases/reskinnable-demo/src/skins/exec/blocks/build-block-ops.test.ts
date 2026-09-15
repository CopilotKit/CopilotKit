import { describe, expect, it } from "vitest";
import {
  A2UI_OPERATIONS_KEY,
  BLOCK_KIND_PROPS,
  buildBlockOps,
  extractSurfaceId,
  isBlockSurfaceId,
  METRIC_BOUND_KINDS,
  BLOCK_SURFACE_PREFIX,
} from "./build-block-ops";
import type { A2UIOp } from "./build-block-ops";
import { CATALOG_ID } from "../catalog/definitions";
import { blockSurfaceIdFrom } from "@/shell/chat/inline-block-surface";
import type { BlockSpec } from "../data/types";

const spec = {
  kind: "metricTile",
  title: "Revenue vs plan",
  metricId: "revenue",
  compare: "plan",
} as const;

type Component = Record<string, unknown> & { id: string };

function createSurfaceOf(ops: A2UIOp[]) {
  const op = ops.find((o) => "createSurface" in o) as
    | { version?: string; createSurface: Record<string, unknown> }
    | undefined;
  return op;
}

function componentsOf(ops: A2UIOp[]): Component[] {
  const op = ops.find((o) => "updateComponents" in o) as
    | { updateComponents: { components: Component[] } }
    | undefined;
  return op?.updateComponents.components ?? [];
}

describe("buildBlockOps", () => {
  it("targets a block-prefixed surface id extractable from the ops", () => {
    const ops = buildBlockOps(spec, "b1");
    const id = extractSurfaceId(ops);
    expect(id).toBe(`${BLOCK_SURFACE_PREFIX}b1`);
    expect(isBlockSurfaceId(id)).toBe(true);
  });

  /**
   * DRIFT GUARD for the deliberate duplicate. `BLOCK_SURFACE_PREFIX` (and
   * `A2UI_OPERATIONS_KEY`) are spelled a second time inside
   * `src/shell/chat/inline-block-surface.tsx` — the shell must not import from
   * `src/skins/`, so the two copies are kept in sync by hand. Asserting our
   * constant against ITSELF proves nothing; this runs the ops we MINT through
   * the shell's own reader, so either copy drifting (prefix or operations key)
   * fails here instead of silently routing blocks to the canvas.
   */
  it("mints surface ids the shell's own reader recognizes", () => {
    const ops = buildBlockOps(spec, "b1");
    expect(blockSurfaceIdFrom({ [A2UI_OPERATIONS_KEY]: ops })).toBe(
      `${BLOCK_SURFACE_PREFIX}b1`,
    );
  });

  it("emits createSurface for OUR catalog and a v0.9 version on every op", () => {
    const ops = buildBlockOps(spec, "b1");
    expect(createSurfaceOf(ops)?.createSurface).toEqual({
      surfaceId: `${BLOCK_SURFACE_PREFIX}b1`,
      catalogId: CATALOG_ID,
    });
    for (const op of ops) expect(op.version).toBe("v0.9");
  });

  it("roots the tree at a Stack whose children all exist as components", () => {
    for (const pinned of [false, true]) {
      const comps = componentsOf(buildBlockOps(spec, "b1", { pinned }));
      const root = comps.find((c) => c.id === "root");
      expect(root).toMatchObject({ component: "Stack" });
      const ids = new Set(comps.map((c) => c.id));
      const children = root!.children as string[];
      expect(children.length).toBeGreaterThan(0);
      for (const childId of children) expect(ids.has(childId)).toBe(true);
    }
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
   * EXACT key set, not `toMatchObject`: the catalog definitions run each
   * component's props through zod, which STRIPS undeclared keys silently, so
   * a forwarded-but-undeclared prop (compare on VarianceBar, months on
   * MetricTile) produces no error anywhere — it just never arrives. A subset
   * assertion survives that mutation; the exact key set does not. Keys are
   * compared rather than values because a forwarded-but-absent prop lands as
   * `key: undefined`, which `Object.keys` still reports.
   */
  const kindFixtures: ReadonlyArray<{
    spec: BlockSpec;
    keys: string[];
  }> = [
    {
      spec: {
        kind: "metricTile",
        title: "T",
        metricId: "revenue",
        department: "all",
        compare: "plan",
      },
      keys: ["id", "component", "metricId", "department", "compare"],
    },
    {
      spec: {
        kind: "trendLine",
        title: "T",
        metricId: "burnRate",
        department: "all",
        months: 12,
      },
      keys: ["id", "component", "metricId", "department", "months"],
    },
    {
      spec: { kind: "varianceBar", title: "T", metricId: "opex" },
      keys: ["id", "component", "metricId"],
    },
    {
      spec: { kind: "initiativeTable", title: "T" },
      keys: ["id", "component"],
    },
    { spec: { kind: "exceptionList", title: "T" }, keys: ["id", "component"] },
  ];

  it.each(kindFixtures)(
    "forwards exactly the props $spec.kind's catalog definition declares",
    ({ spec: kindSpec, keys }) => {
      const comps = componentsOf(buildBlockOps(kindSpec, "b1"));
      const kindComponent = comps.find((c) => c.id === "kind");
      expect(kindComponent).toBeDefined();
      expect(Object.keys(kindComponent!).sort()).toEqual([...keys].sort());
    },
  );

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

  /**
   * A metricId outside the catalog's enum is stripped by the renderer's zod
   * schema exactly like a missing one — the tile binds nothing and renders
   * blank. The agent's tool schema already refuses it (`z.enum`), so this
   * catches the other callers: a stored spec the ledger GET rebuilds, a seed,
   * a test.
   */
  it("throws UNKNOWN_METRIC_ID for a metricId outside the catalog's enum", () => {
    const bogusMetric = {
      kind: "metricTile",
      title: "Profit",
      metricId: "profit",
    } as unknown as BlockSpec;
    expect(() => buildBlockOps(bogusMetric, "b1")).toThrow(
      /^UNKNOWN_METRIC_ID/,
    );
  });

  /**
   * `months` is a trailing-window size TrendLine slices history with
   * (`periods.slice(-months)`). `0` is the dangerous one: `slice(-0)` is
   * `slice(0)` — the FULL history, silently, on a chart the user asked to
   * narrow.
   */
  it.each([0, -3, 1.5, Number.NaN])(
    "throws MONTHS_INVALID for months=%s",
    (months) => {
      const badWindow = {
        kind: "trendLine",
        title: "Burn",
        metricId: "burnRate",
        months,
      } as BlockSpec;
      expect(() => buildBlockOps(badWindow, "b1")).toThrow(/^MONTHS_INVALID/);
    },
  );

  /**
   * Kind-inapplicable props were SILENTLY DROPPED by `buildKindComponent`:
   * a trendLine asking to compare against forecast, or a varianceBar scoped
   * to one department, built ops that ignored the request with no error. The
   * agent tool refuses these up front; this is the same contract for every
   * other path (ledger rebuild, seeds, tests).
   */
  it.each([
    ["trendLine", "compare", { compare: "plan" }],
    ["varianceBar", "department", { department: "all" }],
    ["varianceBar", "compare", { compare: "plan" }],
    ["varianceBar", "months", { months: 6 }],
    ["metricTile", "months", { months: 6 }],
    ["initiativeTable", "metricId", { metricId: "revenue" }],
    ["exceptionList", "department", { department: "all" }],
  ] as const)(
    "throws UNSUPPORTED_BLOCK_PROP for %s carrying %s",
    (kind, prop, extra) => {
      // Metric-bound kinds need a metricId to get past METRIC_ID_REQUIRED;
      // the other two do not support one at all.
      const metricBound = ["metricTile", "trendLine", "varianceBar"].includes(
        kind,
      );
      const offending = {
        kind,
        title: "T",
        ...(metricBound ? { metricId: "opex" } : {}),
        ...extra,
      } as BlockSpec;
      expect(() => buildBlockOps(offending, "b1")).toThrow(
        `UNSUPPORTED_BLOCK_PROP: a "${kind}" block does not support "${prop}"`,
      );
    },
  );

  /**
   * ONE SPELLING, TWO ENFORCERS. `agent.ts`'s `render_metric_block` returns
   * this same condition as a friendly RESULT (so the model can retry) where
   * `assertValidBlockSpec` THROWS it (so every other caller fails loud), and
   * the two used to disagree on the code itself — `UNSUPPORTED_BLOCK_PROP`
   * there, `KIND_PROP_UNSUPPORTED` here — while five comments across three
   * files claimed they matched. Nothing keys on the spelling at runtime
   * (`tools.tsx`'s settle classifier reads the error SHAPE), which is exactly
   * why the drift survived: it cost nothing until someone grepped for one
   * spelling and concluded the other path did not exist.
   */
  it("throws the same code agent.ts returns for the same condition", () => {
    const offending = {
      kind: "varianceBar",
      title: "T",
      metricId: "opex",
      department: "all",
    } as BlockSpec;
    expect(() => buildBlockOps(offending, "b1")).toThrow(
      /^UNSUPPORTED_BLOCK_PROP/,
    );
  });

  /**
   * THE DRIFT GUARD for the table `agent.ts` now DERIVES its tool-boundary
   * guard from. `BLOCK_KIND_PROPS` is exported so the tool no longer
   * hand-copies a module-private list; that only helps if the exported table
   * still describes what `buildKindComponent` actually forwards. Asserted
   * against the built ops rather than against the switch's source, so a case
   * arm that stops forwarding a declared prop fails here.
   */
  it("declares, per kind, exactly the props buildKindComponent forwards", () => {
    for (const [kind, props] of Object.entries(BLOCK_KIND_PROPS)) {
      const declaring = {
        kind,
        title: "T",
        ...(METRIC_BOUND_KINDS.has(kind as BlockSpec["kind"])
          ? { metricId: "opex" }
          : {}),
        ...Object.fromEntries(
          Object.keys(props).map((p) => [
            p,
            { metricId: "opex", department: "all", compare: "plan", months: 6 }[
              p as "metricId" | "department" | "compare" | "months"
            ],
          ]),
        ),
      } as BlockSpec;
      const kindComponent = componentsOf(buildBlockOps(declaring, "b1")).find(
        (c) => c.id === "kind",
      );
      expect(Object.keys(kindComponent!).sort()).toEqual(
        ["id", "component", ...Object.keys(props)].sort(),
      );
    }
  });

  it("accepts every spec the seeded dashboards store", () => {
    const seeded: BlockSpec[] = [
      {
        kind: "metricTile",
        title: "Revenue vs Plan",
        metricId: "revenue",
        department: "all",
        compare: "plan",
      },
      { kind: "initiativeTable", title: "Key Initiatives" },
      { kind: "exceptionList", title: "Open Exceptions" },
      {
        kind: "varianceBar",
        title: "Opex Variance by Department",
        metricId: "opex",
      },
      {
        kind: "trendLine",
        title: "Burn Rate Trend",
        metricId: "burnRate",
        department: "all",
        months: 12,
      },
    ];
    for (const s of seeded) expect(() => buildBlockOps(s, "b1")).not.toThrow();
  });
});

describe("extractSurfaceId", () => {
  /**
   * The op containers were read with a `??` chain, which stops at the first
   * PRESENT key — a `createSurface` without a `surfaceId` (or with an empty
   * one) hid the `updateComponents` sitting beside it in the same op, and the
   * block surface came back null: the card renders on the canvas instead of
   * inline, or not at all.
   */
  it("reads past a present-but-empty container in the same op", () => {
    const ops: A2UIOp[] = [
      {
        version: "v0.9",
        createSurface: {},
        updateComponents: { surfaceId: `${BLOCK_SURFACE_PREFIX}b9` },
      },
    ];
    expect(extractSurfaceId(ops)).toBe(`${BLOCK_SURFACE_PREFIX}b9`);
  });

  it("reads past an empty-string surfaceId", () => {
    const ops: A2UIOp[] = [
      { createSurface: { surfaceId: "" } },
      { updateDataModel: { surfaceId: `${BLOCK_SURFACE_PREFIX}b9` } },
    ];
    expect(extractSurfaceId(ops)).toBe(`${BLOCK_SURFACE_PREFIX}b9`);
  });

  it("returns null when no op carries a surfaceId", () => {
    expect(extractSurfaceId([{ version: "v0.9" }, { createSurface: {} }])).toBe(
      null,
    );
    expect(isBlockSurfaceId(null)).toBe(false);
  });
});
