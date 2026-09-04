import { beforeEach, describe, expect, it } from "vitest";
import {
  execAgent,
  getMetricsTool,
  listExceptionsTool,
  renderMetricBlockTool,
  publishBoardPackTool,
  fileVarianceNarrativeTool,
} from "@/skins/exec/agent";
import * as store from "@/skins/exec/data/store";
import {
  A2UI_OPERATIONS_KEY,
  BLOCK_KIND_PROPS,
  BLOCK_SURFACE_PREFIX,
  extractSurfaceId,
} from "@/skins/exec/blocks/build-block-ops";
import { isBreach, variancePct } from "@/skins/exec/data/derive";

/**
 * WHAT `agent.ts` HAS TO GET RIGHT ON ITS OWN, NOT BY INHERITING FROM
 * `buildBlockOps`/`store.publishPack` (which already have their own tests):
 * the SHAPE it hands back across the tool boundary, and the fact that every
 * failure crosses that boundary as a RESULT rather than as a throw or a
 * schema rejection.
 *
 * THE HANG IS WHY THAT SECOND HALF MATTERS. `@copilotkit/runtime`'s event
 * translation has no `tool-error` arm (verified against `ai@6.0.259`), so
 * anything zod rejects at the parameter boundary — and anything that throws
 * inside `execute` — emits no TOOL_CALL_RESULT at all: the transcript's chip
 * spins InProgress forever, with no block and nothing said, for a mistake one
 * retry would have fixed. Every suite below that asserts `result.error`
 * exists to keep a failure on the readable side of that line.
 *
 * `render_metric_block` is the ONLY tool that puts a chat-composed block on
 * screen — an agent that calls it and gets ops keyed wrong, or a surface id
 * that is not a BLOCK id, is indistinguishable on stage from a model that
 * declined to render anything. And a block the tool forgot to register as a
 * draft (`store.createDraftBlock`) is a block "Add to dashboard" can never
 * find, which fails silently a step later, on a different screen.
 *
 * `get_metrics` and `list_exceptions` are the READ half of rule 1 — the
 * figures the agent is forbidden to invent come from nowhere else, so the
 * variance and breach flags they hand back are pinned here against the
 * ledger's own derivations rather than trusted.
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
 * themselves (per the plan's Task 8 note) rather than extracting them from
 * the agent factory's `config.tools`, so this suite pins the export surface
 * as well as the behaviour.
 */

beforeEach(() => store.reset());

/**
 * The four codes beat 6 exists to TEACH. Spelled here once, at module scope,
 * because two different sweeps need them: the agent-facing TEXT sweep (prompt,
 * tool descriptions and every parameter schema) and the per-refusal check that
 * no error body hands one back.
 */
const WITHHELD_CODES = ["VAR-TIMING", "VAR-ONEOFF", "VAR-FX", "VAR-PLAN"];

/** No refusal may hand the model a code it is supposed to be taught. */
const namesNoCode = (result: unknown) => {
  const text = JSON.stringify(result);
  for (const code of WITHHELD_CODES) expect(text).not.toContain(code);
};

/**
 * EVERY STRING A PARAMETER SCHEMA CARRIES — the `.describe()` texts AND the
 * enum values, which are what a `z.enum` publishes straight into the tool's
 * JSON schema. The withheld-vocabulary sweep used to read only the prompt and
 * the tool descriptions, which left the whole schema unguarded: turning
 * `file_variance_narrative`'s free-string `code` into a `z.enum` of the four
 * codes hands the model the entire catalogue and that suite stayed green.
 *
 * Walked off zod's own `_def` rather than through a JSON-schema conversion, so
 * it needs no serializer that could quietly drop a branch: object shapes
 * (`_def.shape()`), enum members (`_def.values`), descriptions, and the
 * wrapper chain optional/nullable/default/array puts between them.
 */
const schemaStrings = (schema: unknown, depth = 0): string[] => {
  if (depth > 12 || typeof schema !== "object" || schema === null) return [];
  const def = (schema as { _def?: Record<string, unknown> })._def;
  if (!def) return [];
  const out: string[] = [];
  if (typeof def.description === "string") out.push(def.description);
  if (Array.isArray(def.values)) out.push(...def.values.map(String));
  const shape = typeof def.shape === "function" ? def.shape() : def.shape;
  if (shape && typeof shape === "object") {
    for (const child of Object.values(shape)) {
      out.push(...schemaStrings(child, depth + 1));
    }
  }
  for (const key of ["innerType", "type", "schema", "element"]) {
    if (def[key]) out.push(...schemaStrings(def[key], depth + 1));
  }
  return out;
};

describe("get_metrics", () => {
  /**
   * RULE 1'S ARITHMETIC, DONE ONCE. The prompt forbids the model from
   * recomputing variance ("read it, do not recompute it"), which only holds if
   * the tool actually ships the figure — a `rows` array of bare plan/actual
   * pairs reads as success and puts the subtraction back in the model's hands,
   * where a board conversation cannot afford it. Asserted against
   * `./data/derive`'s own functions, the same ones the catalog renderers use,
   * so a figure the agent says and a figure a block draws cannot disagree.
   */
  it("ships variance and the breach flag already computed, per row", async () => {
    const result = (await getMetricsTool.execute!({
      metricId: "opex",
    })) as Record<string, unknown>;

    const def = store.snapshot().metricDefs.find((d) => d.id === "opex")!;
    expect(result.label).toBe(def.label);
    expect(result.unit).toBe(def.unit);
    // The threshold the breach flag was measured against, so the agent can
    // explain WHY a row breaches rather than asserting that it does.
    expect(result.thresholdPct).toBe(def.thresholdPct);

    const rows = result.rows as Record<string, unknown>[];
    const points = store.metricSeries({ metricId: "opex" });
    expect(rows).toHaveLength(points.length);

    for (const [i, row] of rows.entries()) {
      const point = points[i];
      expect(row.period).toBe(point.period);
      expect(row.department).toBe(point.department);
      expect(row.variancePct).toBe(variancePct(point));
      expect(row.breach).toBe(isBreach(def, point));
    }

    // BOTH flags actually occur in this window, or "breach" could be a
    // hardcoded constant and every assertion above would still pass.
    expect(rows.some((r) => r.breach === true)).toBe(true);
    expect(rows.some((r) => r.breach === false)).toBe(true);
  });

  it("scopes to one department and narrows to a trailing window", async () => {
    const result = (await getMetricsTool.execute!({
      metricId: "opex",
      department: "distribution",
      months: 3,
    })) as Record<string, unknown>;

    const rows = result.rows as { period: string; department: string }[];
    expect(rows.every((r) => r.department === "distribution")).toBe(true);
    expect(new Set(rows.map((r) => r.period)).size).toBe(3);
  });

  /**
   * THE SCHEMA-LEVEL HANG. `months` used to be `z.number().int().positive()`,
   * which is a PARAMETER constraint: `months: 0` never reaches `execute` at
   * all, so the runtime emits no result and the chip spins forever. Relaxed to
   * a plain number and judged HERE, where a refusal is an ordinary tool output
   * the model reads and corrects in one retry.
   *
   * Invoked directly, as every test in this file invokes it, a schema
   * refinement would not run at all — so putting the constraint back in the
   * schema fails these outright rather than passing by accident.
   */
  it.each([0, -3, 1.5, Number.NaN])(
    "refuses months=%s as a READABLE RESULT, never a validation hang",
    async (months) => {
      const result = (await getMetricsTool.execute!({
        metricId: "opex",
        months,
      })) as Record<string, unknown>;

      expect(
        result.error,
        "a schema rejection never reaches the client — the chip spins InProgress forever",
      ).toBe("MONTHS_INVALID");
      expect(String(result.message)).toContain("months");
      // It rendered no rows: a refusal that still answers is a refusal the
      // model has no reason to act on.
      expect(result.rows).toBeUndefined();
    },
  );

  it("still reads the full history when months is omitted", async () => {
    const result = (await getMetricsTool.execute!({
      metricId: "opex",
    })) as Record<string, unknown>;
    expect(result.error).toBeUndefined();
    expect((result.rows as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("list_exceptions", () => {
  /**
   * `explained` is the field beat 6 turns on — the publish gate refuses on an
   * unexplained breach — so it is returned verbatim rather than summarized
   * away, and it has to MOVE when a narrative is filed. A snapshot taken once
   * and cached would pass a static assertion and strand the agent in rule 7's
   * loop with nothing changing between reads.
   */
  it("reads the ledger's breaches back, and flips explained when one is filed", async () => {
    const first = (await listExceptionsTool.execute!({})) as {
      exceptions: { metricId: string; period: string; explained: boolean }[];
    };
    expect(first.exceptions).toEqual(store.exceptions());

    const open = first.exceptions.find(
      (e) => e.metricId === "opex" && !e.explained,
    );
    if (!open) {
      throw new Error(
        "fixture assumption broken: the seed no longer leaves an opex breach open",
      );
    }

    await fileVarianceNarrativeTool.execute!({
      metricId: "opex",
      period: open.period,
      code: "VAR-TIMING",
      body: "Shipment timing shift pushed the spend into this period.",
    });

    const second = (await listExceptionsTool.execute!({})) as {
      exceptions: { metricId: string; period: string; explained: boolean }[];
    };
    expect(
      second.exceptions.find(
        (e) => e.metricId === "opex" && e.period === open.period,
      )?.explained,
    ).toBe(true);
  });
});

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

  /**
   * THE HANG. `metricId` is required for the three metric-bound kinds, and
   * that requirement used to live in the parameter schema as a
   * `.superRefine()`. A zod failure at the parameter boundary NEVER reaches
   * `execute`: the AI SDK emits a `tool-error` stream part, and
   * `@copilotkit/runtime`'s event translation has no arm for one, so no
   * TOOL_CALL_RESULT is emitted and the transcript's chip spins InProgress
   * forever — with no block and nothing said, for a mistake one retry would
   * have fixed.
   *
   * These two tests exercise the guard THROUGH `execute`, which is the only
   * place it can produce a result the model can read and act on. They are
   * also why the guard cannot go back into the schema: invoked directly, as
   * every test in this file invokes it, a schema refinement is not run at
   * all, so these assertions fail outright rather than passing by accident.
   */
  it.each(["metricTile", "trendLine", "varianceBar"] as const)(
    "refuses a %s with no metricId as a READABLE RESULT, never a validation throw",
    async (kind) => {
      const result = (await renderMetricBlockTool.execute!({
        kind,
        title: "Missing its metric",
      })) as Record<string, unknown>;

      expect(
        result.error,
        "the refusal has to arrive as a tool RESULT the model can read; a zod/throw refusal never reaches the client at all",
      ).toBe("METRIC_ID_REQUIRED");

      // It must name the problem AND the way out, or the model retries the
      // identical call.
      expect(String(result.message)).toContain("metricId");
      expect(String(result.message)).toContain(kind);

      // And it rendered NOTHING: no ops to draw an empty block from, and no
      // blockId that would let a later `pinBlockToDashboard` pin a tile bound
      // to no metric.
      expect(result[A2UI_OPERATIONS_KEY]).toBeUndefined();
      expect(result.blockId).toBeUndefined();
    },
  );

  /**
   * THE PHANTOM LEVER. Every prop the schema offers is accepted for every
   * kind, but `buildKindComponent` forwards only the ones that kind's catalog
   * definition declares — so `compare` on a trendLine, `months` on a
   * metricTile and `department` on a varianceBar were taken, silently dropped,
   * and then PERSISTED into the stored spec. On screen the varianceBar still
   * drew all four departments while the agent said, truthfully as far as it
   * knew, that it had scoped the block to Distribution.
   *
   * Refused as a RESULT rather than stripped: a strip is the same silence with
   * extra steps, and the model has no way to learn that the block it is
   * looking at is not the block it asked for.
   */
  it.each([
    ["trendLine", "compare", { compare: "plan" }],
    ["metricTile", "months", { months: 6 }],
    ["varianceBar", "department", { department: "distribution" }],
    ["varianceBar", "compare", { compare: "forecast" }],
  ] as const)(
    "refuses %s + %s as a READABLE RESULT instead of dropping the prop",
    async (kind, prop, extra) => {
      const result = (await renderMetricBlockTool.execute!({
        kind,
        title: "Scoped to something it cannot honour",
        metricId: "opex",
        ...extra,
      })) as Record<string, unknown>;

      expect(result.error).toBe("UNSUPPORTED_BLOCK_PROP");
      expect(String(result.message)).toContain(kind);
      expect(String(result.message)).toContain(prop);

      // Nothing rendered and nothing stored — a dropped prop must not reach
      // the spec the ledger route rebuilds ops from on every read.
      expect(result[A2UI_OPERATIONS_KEY]).toBeUndefined();
      expect(result.blockId).toBeUndefined();
    },
  );

  it("refuses a metricId on the self-binding kinds, which bind their own rows", async () => {
    const result = (await renderMetricBlockTool.execute!({
      kind: "exceptionList",
      title: "Open exceptions",
      metricId: "opex",
    })) as Record<string, unknown>;

    expect(result.error).toBe("UNSUPPORTED_BLOCK_PROP");
    expect(String(result.message)).toContain("metricId");
    expect(result.blockId).toBeUndefined();
  });

  it("still renders every prop each kind actually honours", async () => {
    // The guard must be a scalpel: metricTile keeps department + compare and
    // trendLine keeps department + months, or beat 1 and beat 4 lose the two
    // blocks they are built from.
    const tile = (await renderMetricBlockTool.execute!({
      kind: "metricTile",
      title: "Distribution opex vs plan",
      metricId: "opex",
      department: "distribution",
      compare: "plan",
    })) as Record<string, unknown>;
    expect(tile.error).toBeUndefined();
    expect(typeof tile.blockId).toBe("string");

    const trend = (await renderMetricBlockTool.execute!({
      kind: "trendLine",
      title: "Distribution opex trend",
      metricId: "opex",
      department: "distribution",
      months: 6,
    })) as Record<string, unknown>;
    expect(trend.error).toBeUndefined();
    expect(typeof trend.blockId).toBe("string");
  });

  it("still renders the two self-binding kinds with no metricId", async () => {
    // The guard must be scoped to the metric-bound kinds only — an
    // exceptionList carries its own rows, and refusing it would break beat 6's
    // "what needs explaining" block.
    const result = (await renderMetricBlockTool.execute!({
      kind: "exceptionList",
      title: "Open exceptions",
    })) as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect(result[A2UI_OPERATIONS_KEY]).toBeDefined();
    expect(typeof result.blockId).toBe("string");
  });

  /**
   * THE HAND-COPIED TABLE, DERIVED INSTEAD. `agent.ts`'s prop guard used to
   * re-list per kind what `build-block-ops.ts` already declares in its
   * (module-private) `KIND_PROPS`, so the two could drift and the drift was
   * invisible: a prop the builder started forwarding but the tool still
   * refused reads as a phantom lever in reverse.
   *
   * This walks the EXPORTED map and asserts both directions per kind, so
   * adding a prop in one place and not the other fails here rather than on
   * stage. The fixtures are deliberately the ones the OTHER guards all admit —
   * a per-department metric and a real trailing window — so a failure here can
   * only mean a prop-support disagreement, never the byDepartment or months
   * refusal wandering into frame.
   */
  const PROP_FIXTURES = {
    metricId: "opex",
    department: "distribution",
    compare: "plan",
    months: 6,
  } as const;

  it.each(Object.keys(BLOCK_KIND_PROPS) as (keyof typeof BLOCK_KIND_PROPS)[])(
    "honours exactly the props build-block-ops declares for %s",
    async (kind) => {
      const supported = Object.keys(BLOCK_KIND_PROPS[kind]);
      const all = Object.keys(PROP_FIXTURES) as (keyof typeof PROP_FIXTURES)[];

      const accepted = (await renderMetricBlockTool.execute!({
        kind,
        title: "Every prop this kind declares",
        ...Object.fromEntries(
          supported.map((p) => [
            p,
            PROP_FIXTURES[p as keyof typeof PROP_FIXTURES],
          ]),
        ),
      })) as Record<string, unknown>;
      expect(accepted.error).toBeUndefined();

      for (const prop of all.filter((p) => !supported.includes(p))) {
        const refused = (await renderMetricBlockTool.execute!({
          kind,
          title: "One prop too many",
          ...Object.fromEntries(
            supported.map((p) => [
              p,
              PROP_FIXTURES[p as keyof typeof PROP_FIXTURES],
            ]),
          ),
          [prop]: PROP_FIXTURES[prop],
        })) as Record<string, unknown>;
        expect(refused.error).toBe("UNSUPPORTED_BLOCK_PROP");
        expect(String(refused.message)).toContain(prop);
        expect(refused.blockId).toBeUndefined();
      }
    },
  );

  /**
   * THE SCHEMA-LEVEL HANG, ON THE BLOCK SIDE. `months` was
   * `z.number().int().positive()` here too, so `months: 0` never reached
   * `execute` — and had it reached, `store.createDraftBlock` /
   * `buildBlockOps` would have THROWN `MONTHS_INVALID` out of `execute`, which
   * the runtime cannot translate either. Both roads end at the same spinning
   * chip; a result is the only one the model can act on.
   *
   * `0` is the dangerous value rather than an obviously silly one: TrendLine
   * narrows with `periods.slice(-months)`, and `slice(-0)` is `slice(0)` — the
   * FULL history on a chart the caller asked to narrow.
   */
  it.each([0, -3, 1.5, Number.NaN])(
    "refuses a trendLine months=%s as a READABLE RESULT, never a throw",
    async (months) => {
      const result = (await renderMetricBlockTool.execute!({
        kind: "trendLine",
        title: "Burn rate trend",
        metricId: "burnRate",
        months,
      })) as Record<string, unknown>;

      expect(result.error).toBe("MONTHS_INVALID");
      expect(String(result.message)).toContain("months");
      expect(result[A2UI_OPERATIONS_KEY]).toBeUndefined();
      expect(result.blockId).toBeUndefined();
    },
  );

  /**
   * THE GREEN BLOCK THAT RENDERS RED. A `varianceBar` draws one bar per
   * department, so it only means anything for a metric that HAS per-department
   * series (`MetricDef.byDepartment` — 'opex' and 'headcountCost' alone). Asked
   * for `revenue` it passed both guards, settled green, and the catalog
   * renderer drew a "Variance unavailable" card: the agent said it had shown
   * the variance, and the room saw an error tile. Same for a `department` scope
   * on a company-wide metric — `metricSeries` filters to nothing.
   *
   * Refused as a RESULT that NAMES the metric, so the retry can pick a metric
   * that does break out by department (or drop the scope) rather than repeat
   * the call.
   */
  it.each([
    ["varianceBar", { kind: "varianceBar", metricId: "revenue" }],
    [
      "metricTile",
      { kind: "metricTile", metricId: "revenue", department: "distribution" },
    ],
    [
      "trendLine",
      { kind: "trendLine", metricId: "revenue", department: "manufacturing" },
    ],
  ] as const)(
    "refuses a %s scoped by department on a company-wide metric",
    async (_kind, spec) => {
      const result = (await renderMetricBlockTool.execute!({
        ...spec,
        title: "Scoped to departments it does not have",
      })) as Record<string, unknown>;

      expect(result.error).toBe("METRIC_NOT_BY_DEPARTMENT");
      // It names the metric, or the model cannot tell WHICH part to change.
      expect(String(result.message)).toContain("revenue");
      expect(result[A2UI_OPERATIONS_KEY]).toBeUndefined();
      expect(result.blockId).toBeUndefined();
    },
  );

  it("still renders the per-department metrics the guard exists to admit", async () => {
    for (const metricId of ["opex", "headcountCost"] as const) {
      const bar = (await renderMetricBlockTool.execute!({
        kind: "varianceBar",
        title: "Variance by department",
        metricId,
      })) as Record<string, unknown>;
      expect(bar.error).toBeUndefined();

      const tile = (await renderMetricBlockTool.execute!({
        kind: "metricTile",
        title: "Distribution",
        metricId,
        department: "distribution",
      })) as Record<string, unknown>;
      expect(tile.error).toBeUndefined();
    }

    // And "all" is the company-wide series, not a department — it must stay
    // legal on a company-wide metric.
    const companyWide = (await renderMetricBlockTool.execute!({
      kind: "metricTile",
      title: "Revenue",
      metricId: "revenue",
      department: "all",
    })) as Record<string, unknown>;
    expect(companyWide.error).toBeUndefined();
  });
});

/**
 * THE ONE-STEP RUN. `@copilotkit/runtime` forwards `maxSteps` into
 * `streamText` as `stopWhen: config.maxSteps ? stepCountIs(config.maxSteps) :
 * undefined`, and the AI SDK's own default is `stopWhen = stepCountIs(1)`.
 * With `maxSteps` unset the run therefore ENDS the moment a backend tool
 * returns — no follow-up model turn, so `get_metrics` never becomes a
 * sentence, `render_metric_block` never gets the prose EXEC_PROMPT rule 2
 * requires, and neither beat 5's render→pin procedure nor beat 6's
 * read→file→re-publish arc can chain. Nothing else in the stack papers over
 * it: `CopilotKitCore` starts a follow-up run only when a FRONTEND tool
 * executed.
 *
 * Read through the same `as unknown as { config }` cast keel's
 * `agent.test.ts` uses (`config` is `private` to TypeScript and present at
 * runtime) so this pins the value actually handed to `BuiltInAgent`, not a
 * copy of it.
 */
describe("execAgent configuration", () => {
  const config = () =>
    (execAgent() as unknown as { config: Record<string, unknown> }).config;

  it("sets maxSteps so a backend tool call is not the end of the run", () => {
    expect(
      config().maxSteps,
      "unset means stopWhen: stepCountIs(1) — the run ends on the first tool result",
    ).toBe(12);
  });

  it("registers exactly the four tools EXEC_PROMPT advertises", () => {
    // `publish_board_pack` must stay OUT: the countersign card is the agent's
    // only publish path (see that tool's doc comment in `agent.ts`).
    const names = (config().tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual([
      "get_metrics",
      "list_exceptions",
      "render_metric_block",
      "file_variance_narrative",
    ]);
  });

  /**
   * EXPORTED BUT NOT REGISTERED — both halves, stated as one assertion.
   *
   * The roster above pins the four names, but nothing pinned the pair of
   * facts `publish_board_pack` actually turns on: it exists under exactly that
   * name (the suite below calls its `execute` as the only caller there is, and
   * the countersign card in `tools.tsx` reaches it by name), AND it is absent
   * from what the model can call. Registering it would hand the agent a
   * publish path around the countersign card; renaming or dropping the export
   * would silently leave the card with nothing to call.
   */
  it("exports publish_board_pack without registering it for the model", () => {
    expect(publishBoardPackTool.name).toBe("publish_board_pack");
    expect(typeof publishBoardPackTool.execute).toBe("function");

    const names = (config().tools as { name: string }[]).map((t) => t.name);
    expect(
      names,
      "the countersign card is the only publish path — a registered publish tool routes around it",
    ).not.toContain(publishBoardPackTool.name);
  });
});

/**
 * BEAT 6's WITHHELD VOCABULARY, as an invariant rather than a comment.
 *
 * The publish gate is cleared by FILING a narrative, so an agent that can read
 * a valid code off any agent-facing string clears the gate unaided and the
 * teach arc silently stops existing. The prompt and every registered tool
 * description are agent-facing, so none of them may name a code — and the
 * `code` parameter must stay a free string rather than an enum, which would
 * publish the whole catalogue into the tool's JSON schema.
 */
describe("exec agent-facing text", () => {
  const config = () =>
    (
      execAgent() as unknown as {
        config: {
          prompt: string;
          tools: { description: string; parameters: unknown }[];
        };
      }
    ).config;

  const surfaces = () => {
    const { prompt, tools } = config();
    return [prompt, ...tools.map((t) => t.description)];
  };

  const schemaSurfaces = () =>
    config().tools.flatMap((t) => schemaStrings(t.parameters));

  it("names no narrative code in the prompt or any tool description", () => {
    for (const text of surfaces()) {
      expect(
        text,
        `leaked a narrative code: ${text.slice(0, 60)}…`,
      ).not.toMatch(/VAR-/);
    }
  });

  it("names no narrative code in any tool's PARAMETER SCHEMA either", () => {
    const strings = schemaSurfaces();
    // The walker must actually be reading something — an extractor that
    // silently returns [] passes the assertion below for the wrong reason.
    expect(
      strings.some((s) => s.includes("Which metric to read.")),
      "the schema walker found no known describe() text — it is not reading the schemas",
    ).toBe(true);
    expect(
      strings.some((s) => s === "revenue"),
      "the schema walker found no known enum member — it is not reading enum values",
    ).toBe(true);

    for (const text of strings) {
      expect(
        text,
        `leaked a narrative code into a schema: ${text}`,
      ).not.toMatch(/VAR-/);
    }
    for (const code of WITHHELD_CODES) {
      expect(strings.join("\n")).not.toContain(code);
    }
  });

  it("tells the model to SAY a lever is unset rather than omit it", () => {
    // navigateTo's levers are all REQUIRED with explicit sentinels
    // ("any"/0/false — see `tools.tsx`). The prompt used to tell the model to
    // "leave the others unset", which the schema does not allow: told to omit
    // an enum it cannot omit, gpt-5.4 fills it and puts an empty board on
    // screen under four confidently tinted controls.
    const prompt = surfaces()[0];
    expect(prompt).not.toMatch(/leave the others unset/i);
    expect(prompt).toMatch(/"any"/);
  });

  /**
   * THE INVENTORY HAS TO MATCH THE RULES. Rules 7, 11 and 13 all instruct the
   * model to call `recall_memory` (and 7/13 to `save_memory`), but the closing
   * inventory listed only the backend and frontend tools — so the two tools
   * three numbered rules turn on were the only ones the model was never told
   * it had. They attach over MCP (`app/api/copilotkit/[[...slug]]/route.ts`),
   * which is exactly why the prompt has to name them: they are not in the
   * agent's own `tools` array for the roster test above to cover.
   */
  it("lists the memory tools its own numbered rules tell the model to call", () => {
    const prompt = surfaces()[0];
    const inventory = prompt.slice(prompt.indexOf("Backend tools available"));
    expect(inventory).toContain("recall_memory");
    expect(inventory).toContain("save_memory");
  });

  it("tells the model to render blocks one at a time", () => {
    // Two `render_metric_block` calls in one step collide on a single a2ui
    // surface and the second replaces the first (upstream
    // @ag-ui/a2ui-middleware key collision on parallel tool calls), so the
    // prompt has to forbid the batch.
    expect(surfaces()[0]).toMatch(/ONE BLOCK AT A TIME/);
  });
});

/**
 * `file_variance_narrative` calls `store.fileNarrative` DIRECTLY (see
 * `agent.ts`'s doc comment above `PERIOD_RE`) — it never goes through the
 * REST route (`src/app/api/exec/v1/narratives/route.ts`), so that route's
 * zod validation buys this tool nothing. It needs, and has, its own guards
 * for the same two silent-demo-killers: a mistyped period that files a
 * narrative matching no breach, and an empty body that flips `explained` on
 * nothing. Both refusals must stay CODE-FREE, same as the `BAD_CODE` one
 * below.
 */
describe("file_variance_narrative", () => {
  /**
   * DERIVED FROM THE SEED, NEVER HARDCODED. The ledger's 24 periods end at the
   * latest CLOSED month (`data/seed.ts`'s `latestClosedMonth`), so they MOVE
   * with the calendar: the literal "2024-06" this fixture used to carry named
   * a period the store stopped holding, which is exactly the filing the
   * existence guard below now refuses.
   */
  const openBreach = () => {
    const exception = store
      .exceptions()
      .find((e) => e.metricId === "opex" && !e.explained);
    if (!exception) {
      throw new Error(
        "fixture assumption broken: the seed no longer leaves an opex breach open",
      );
    }
    return exception;
  };

  /** An opex period the ledger HOLDS but does not breach — 24 months back. */
  const settledPeriod = () => {
    const rows = store.metricSeries({ metricId: "opex", department: "all" });
    const period = rows[0]?.period;
    if (!period || period === openBreach().period) {
      throw new Error(
        "fixture assumption broken: the seed no longer holds a settled opex period",
      );
    }
    return period;
  };

  const validArgs = () => ({
    metricId: "opex" as const,
    period: openBreach().period,
    code: "VAR-TIMING",
    body: "Shipment timing shift pushed the spend into this period.",
  });

  it("refuses a malformed period and names no code — the store gains no narrative", async () => {
    const before = store.snapshot().narratives.length;
    const result = (await fileVarianceNarrativeTool.execute!({
      ...validArgs(),
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
      ...validArgs(),
      body: "   ",
    })) as Record<string, unknown>;

    expect(result.error).toBe("EMPTY_BODY");
    namesNoCode(result);
    expect(store.snapshot().narratives.length).toBe(before);
  });

  it("files a valid narrative with the body trimmed, and clears its exception", async () => {
    const { period } = openBreach();
    const result = (await fileVarianceNarrativeTool.execute!({
      ...validArgs(),
      body: "  Shipment timing shift.  ",
    })) as Record<string, unknown>;

    const narrative = result.narrative as { body: string } | undefined;
    expect(narrative?.body).toBe("Shipment timing shift.");

    // Filing against a REAL open breach carries no note — there is nothing to
    // warn about, and a note here would read as a failure on the happy path.
    expect(result.note).toBeUndefined();
    expect(
      store
        .exceptions()
        .find((e) => e.metricId === "opex" && e.period === period)?.explained,
    ).toBe(true);
  });

  /**
   * THE CODE COPIED VERBATIM — WITH ITS WHITESPACE. EXEC_PROMPT rule 6 tells
   * the model to use a code exactly as the operator, a saved procedure or an
   * attached document gave it, and forbids retrying with a different one. A
   * code lifted off a filing form or out of a PDF arrives padded ("VAR-… \n"),
   * and refusing THAT with BAD_CODE is a dead end on stage: the model did
   * everything the prompt asked and has nothing left it is allowed to try.
   */
  it("files a code that arrived with stray whitespace around it", async () => {
    const result = (await fileVarianceNarrativeTool.execute!({
      ...validArgs(),
      code: "  VAR-TIMING\n",
    })) as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    const narrative = result.narrative as { code: string } | undefined;
    expect(narrative?.code).toBe("VAR-TIMING");
    expect(store.snapshot().narratives).toHaveLength(1);
  });

  /**
   * THE REFUSAL THAT MUST TEACH NOTHING. An invented code is refused — but the
   * refusal is the one place a catalogue could leak by way of "did you mean",
   * a list of accepted values, or a zod enum error. Asserted against the
   * RESULT OBJECT, not just the prompt: the withheld-vocabulary suite above
   * sweeps the STATIC surfaces (prompt, tool descriptions, parameter schemas),
   * and a code named in an error body at runtime reaches the model just as
   * surely.
   */
  it("refuses an invented code as a readable result that names no valid code", async () => {
    const before = store.snapshot().narratives.length;
    const result = (await fileVarianceNarrativeTool.execute!({
      ...validArgs(),
      code: "VAR-MADE-UP",
    })) as Record<string, unknown>;

    expect(
      result.error,
      "the refusal has to arrive as a tool RESULT; a throw never reaches the client at all",
    ).toBe("BAD_CODE");
    namesNoCode(result);

    // It says what to do instead — ask — or the model simply guesses again.
    expect(String(result.message)).toMatch(/ask/i);
    expect(store.snapshot().narratives.length).toBe(before);
  });

  it("refuses a code that is only whitespace-padded nonsense, still naming none", async () => {
    const result = (await fileVarianceNarrativeTool.execute!({
      ...validArgs(),
      code: "   ",
    })) as Record<string, unknown>;

    expect(result.error).toBe("BAD_CODE");
    namesNoCode(result);
    expect(store.snapshot().narratives).toHaveLength(0);
  });

  /**
   * THE GREEN LIE. A shape-valid (metricId, period) that names no row in the
   * ledger used to file cleanly: the tool said "filed", the store gained a
   * narrative matching no point, and the publish gate went on refusing with
   * nothing to connect the two. The agent's only readable signal was success,
   * so rule 7 sent it round the same loop again.
   */
  it("refuses a period the ledger holds no row for — the store gains no narrative", async () => {
    const before = store.snapshot().narratives.length;
    const result = (await fileVarianceNarrativeTool.execute!({
      ...validArgs(),
      period: "2030-01",
    })) as Record<string, unknown>;

    expect(result.error).toBe("NO_LEDGER_POINT");
    expect(String(result.message)).toContain("2030-01");
    expect(String(result.message)).toContain("opex");
    // It names the way out: read the ledger and file against a real period.
    expect(String(result.message)).toMatch(/get_metrics|list_exceptions/);
    namesNoCode(result);
    expect(result.narrative).toBeUndefined();
    expect(store.snapshot().narratives.length).toBe(before);
  });

  /**
   * EXISTING BUT NOT BREACHING — filed, and SAID SO. The write semantics do
   * not change (a narrative against a real period is a legitimate record), but
   * the result has to tell the model this filing cleared nothing, or a publish
   * still refused for UNEXPLAINED_VARIANCE looks like the gate contradicting
   * a filing that just succeeded.
   */
  it("files against a real non-breaching period but says no open breach matched", async () => {
    const period = settledPeriod();
    const result = (await fileVarianceNarrativeTool.execute!({
      ...validArgs(),
      period,
    })) as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect((result.narrative as { period: string }).period).toBe(period);
    expect(store.snapshot().narratives).toHaveLength(1);

    const note = String(result.note ?? "");
    expect(
      note,
      "a filing that clears nothing must say so, or the model reads the publish refusal as a contradiction",
    ).not.toBe("");
    expect(note).toContain(period);
    expect(note).toMatch(/list_exceptions/);
    // The NOTE names no code — the filed narrative echoed back beside it does
    // carry one, and must: that is the store's record of what the operator
    // gave the agent, not the tool teaching it a code it did not have.
    namesNoCode({ note });
  });

  /**
   * PROVENANCE IS RECORDED, NOT INFERRED. A narrative typed from what the
   * operator said is `"typed"`; one whose body was read out of an attached
   * document is `"ingested-memo"`, and the board pack can say which. The
   * distinction rides on ONE explicit flag rather than on the body text, so
   * both arms are pinned here — a tool that hardcoded `"typed"` (or dropped
   * the flag on the floor) would file a memo-sourced explanation as the
   * agent's own words, which is the one claim beat 3d exists to keep honest.
   */
  it("records the source the ingestedFromAttachment flag asked for", async () => {
    const typed = (await fileVarianceNarrativeTool.execute!(
      validArgs(),
    )) as Record<string, unknown>;
    expect((typed.narrative as { source: string }).source).toBe("typed");

    store.reset();
    const ingested = (await fileVarianceNarrativeTool.execute!({
      ...validArgs(),
      body: "The attached close memo attributes the overrun to a shipment timing shift.",
      ingestedFromAttachment: true,
    })) as Record<string, unknown>;
    expect((ingested.narrative as { source: string }).source).toBe(
      "ingested-memo",
    );
    expect(store.snapshot().narratives[0].source).toBe("ingested-memo");
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

  /**
   * VERBATIM CUTS BOTH WAYS. `UNEXPLAINED_VARIANCE` carries `breaches`;
   * `EMPTY_DASHBOARD` carries a `message` and nothing else, and it is the one
   * refusal with no phrasing of its own anywhere downstream (`tools.tsx`'s
   * `REFUSAL_PHRASES` words the other six), so a result that keeps only
   * `error` leaves the agent — and the receipt it settles into — with the enum
   * spelled as words and no statement of WHAT the pack lacks. Asserted against
   * the store's own text so this pins the relay, not a re-wording.
   */
  it("relays the EMPTY_DASHBOARD refusal's message, not the bare code", async () => {
    // Ids first: `removeBlock` rewrites the block list it is iterating over.
    const blockIds = store.snapshot().dashboards.cfo.blocks.map((b) => b.id);
    for (const blockId of blockIds) store.removeBlock("cfo", blockId);

    const gate = store.publishPack("cfo", store.COUNTERSIGN_PIN);
    if (gate.ok || gate.code !== "EMPTY_DASHBOARD") {
      throw new Error(
        "fixture assumption broken: a blockless cfo dashboard no longer refuses EMPTY_DASHBOARD",
      );
    }

    const result = (await publishBoardPackTool.execute!({
      dashboardId: "cfo",
      countersignPin: store.COUNTERSIGN_PIN,
    })) as Record<string, unknown>;

    expect(result).toEqual({
      error: "EMPTY_DASHBOARD",
      message: gate.message,
    });
  });
});
