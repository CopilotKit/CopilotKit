import { describe, expect, it, beforeEach } from "vitest";
import { z } from "zod";
import { definitions } from "@/skins/exec/catalog/definitions";
import { getMetricsTool } from "@/skins/exec/agent";
import { sandboxFunctions } from "@/skins/exec/sandbox-functions";
import { POST as fileNarrative } from "@/app/api/exec/v1/narratives/route";
import * as store from "@/skins/exec/data/store";
import type { Department, MetricId } from "@/skins/exec/data/types";

/**
 * ONE VOCABULARY, FOUR RESTATEMENTS, AND THE LEDGER THEY ALL HAVE TO MEAN.
 *
 * `MetricId` and `Department` are TS unions, and a zod schema cannot import a
 * type at runtime — so four separate files restate them as literal lists:
 *
 *   1. `../catalog/definitions.ts`            — what an A2UI block may bind to
 *   2. `../agent.ts`                          — what the server tools accept
 *   3. `../sandbox-functions.ts`              — what the sandbox may read
 *   4. `src/app/api/exec/v1/narratives/route.ts` — what the REST layer accepts
 *
 * All four now carry `as const satisfies Record<MetricId, true>`, which the
 * compiler checks BOTH ways. That is necessary and NOT sufficient, and the
 * comments in (3) and (4) claiming the drift is structurally impossible are
 * overstated on two counts this suite exists to close:
 *
 *  - `satisfies` checks each copy against the UNION, never against the other
 *    copies or against the SEED. A metric in the union with no rows in
 *    `seed.ts` type-checks perfectly and is unaskable at runtime: every schema
 *    accepts it and every read comes back empty.
 *  - A guarded RECORD only helps if the schema is DERIVED from it. A future
 *    edit that leaves the record intact and hand-writes the `z.enum` list
 *    beside it re-opens the drift with every `satisfies` still green. These
 *    assertions read the SCHEMAS, not the records, so that edit fails here.
 *
 * So: adding a metric that misses any copy fails a TEST, rather than silently
 * producing a metric no block can bind, no tool will accept, or the ledger
 * holds no rows for.
 */

/**
 * The canonical union, restated ONCE for the whole suite and pinned to the
 * union by the same compiler check the four production copies use. Adding a
 * member to `MetricId` breaks THIS line first — which is the intended signal:
 * the list below is the checklist of places that then have to agree.
 */
const CANONICAL_METRIC_IDS = {
  revenue: true,
  growthQoQ: true,
  growthYoY: true,
  operatingMargin: true,
  ebitda: true,
  cash: true,
  runwayMonths: true,
  nps: true,
  burnRate: true,
  arAgingDays: true,
  dsoDays: true,
  opex: true,
  headcountCost: true,
  forecastAccuracy: true,
} as const satisfies Record<MetricId, true>;

const CANONICAL_DEPARTMENTS = {
  manufacturing: true,
  distribution: true,
  "field-services": true,
  corporate: true,
} as const satisfies Record<Department, true>;

const METRIC_IDS = Object.keys(CANONICAL_METRIC_IDS) as MetricId[];
const DEPARTMENTS = Object.keys(CANONICAL_DEPARTMENTS) as Department[];

/** Set equality, reported as sorted arrays so a failure names the drift. */
const sorted = (values: readonly string[]) => [...values].sort();

/**
 * The members of a `z.enum`, through whatever `.optional()`/`.nullable()`/
 * `.default()` wrapper the field carries. Reads the SCHEMA the app actually
 * ships rather than the record it was built from — a hand-written enum beside
 * an intact record is exactly the drift this suite has to catch.
 */
const enumOptions = (schema: unknown): string[] => {
  let node = schema;
  for (let depth = 0; depth < 8; depth += 1) {
    const def = (node as { _def?: Record<string, unknown> })?._def;
    if (!def) break;
    if (Array.isArray(def.values)) return def.values.map(String);
    if (!def.innerType) break;
    node = def.innerType;
  }
  throw new Error("not a z.enum (or a wrapper around one)");
};

/** One field of a zod object schema, by name. */
const field = (schema: unknown, name: string): unknown => {
  const shape = (schema as z.ZodObject<z.ZodRawShape>)?.shape;
  const found = shape?.[name];
  if (!found) throw new Error(`schema has no "${name}" field`);
  return found;
};

/** "all" is a `MetricPoint.department` VALUE, not a department — see the seed. */
const withoutAll = (values: readonly string[]) =>
  values.filter((v) => v !== "all");

const sandboxSeries = () => {
  const fn = sandboxFunctions.find((f) => f.name === "getMetricSeries");
  if (!fn) throw new Error("the sandbox no longer exposes getMetricSeries");
  return fn.parameters;
};

describe("the MetricId restatements are set-equal", () => {
  it("catalog/definitions.ts binds exactly the canonical metrics", () => {
    expect(
      sorted(enumOptions(field(definitions.MetricTile.props, "metricId"))),
    ).toEqual(sorted(METRIC_IDS));
  });

  it("agent.ts's tool schema accepts exactly the canonical metrics", () => {
    expect(
      sorted(enumOptions(field(getMetricsTool.parameters, "metricId"))),
    ).toEqual(sorted(METRIC_IDS));
  });

  it("sandbox-functions.ts reads exactly the canonical metrics", () => {
    expect(sorted(enumOptions(field(sandboxSeries(), "metricId")))).toEqual(
      sorted(METRIC_IDS),
    );
  });

  /**
   * The route's copy is module-private and its schema is never exported, so
   * parity is read through the only surface it has: the handler. A metric the
   * route's enum does not know fails zod and comes back BAD_REQUEST; one it
   * knows reaches the code guard and comes back BAD_CODE. The probe therefore
   * costs the ledger nothing — every call is refused before anything is filed.
   */
  describe("the narratives route accepts exactly the canonical metrics", () => {
    beforeEach(() => store.reset());

    const probe = (metricId: string) =>
      fileNarrative(
        new Request("http://localhost/api/exec/v1/narratives", {
          method: "POST",
          body: JSON.stringify({
            metricId,
            period: "2026-01",
            // Deliberately not a real code: this probe is about the metricId
            // enum, and a refusal is the cheapest way past it.
            code: "NOT-A-FILEABLE-CODE",
            body: "parity probe",
          }),
        }),
      );

    it.each(METRIC_IDS)("accepts %s", async (metricId) => {
      const res = await probe(metricId);
      const body = (await res.json()) as { error?: string };
      expect(
        body.error,
        `the route's METRIC_IDS no longer covers "${metricId}"`,
      ).toBe("BAD_CODE");
      expect(store.snapshot().narratives).toHaveLength(0);
    });

    it("still refuses a metric the union does not have", async () => {
      const res = await probe("notAMetric");
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe("BAD_REQUEST");
    });
  });
});

describe("the Department restatements are set-equal", () => {
  it("catalog/definitions.ts scopes to exactly the canonical departments", () => {
    expect(
      sorted(
        withoutAll(
          enumOptions(field(definitions.MetricTile.props, "department")),
        ),
      ),
    ).toEqual(sorted(DEPARTMENTS));
  });

  it("agent.ts's tool schema scopes to exactly the canonical departments", () => {
    expect(
      sorted(
        withoutAll(enumOptions(field(getMetricsTool.parameters, "department"))),
      ),
    ).toEqual(sorted(DEPARTMENTS));
  });

  it("sandbox-functions.ts scopes to exactly the canonical departments", () => {
    expect(
      sorted(withoutAll(enumOptions(field(sandboxSeries(), "department")))),
    ).toEqual(sorted(DEPARTMENTS));
  });

  /** Every schema offers "all", because it is a real series in the ledger. */
  it("every schema offers the company-wide series", () => {
    for (const schema of [
      field(definitions.MetricTile.props, "department"),
      field(getMetricsTool.parameters, "department"),
      field(sandboxSeries(), "department"),
    ]) {
      expect(enumOptions(schema)).toContain("all");
    }
  });
});

/**
 * WHAT `satisfies` CANNOT SEE. The four copies are checked against the union;
 * none of them is checked against the ledger. A metric added to the union and
 * to all four schemas — every typecheck green — is still unaskable if the seed
 * grows no rows for it: `get_metrics` answers with an empty series and a block
 * bound to it draws its no-data card, on stage, with nothing failing anywhere.
 */
describe("the seed holds the vocabulary the schemas publish", () => {
  beforeEach(() => store.reset());

  it("defines every canonical metric, and no other", () => {
    const ids = store.snapshot().metricDefs.map((d) => d.id);
    expect(sorted(ids)).toEqual(sorted(METRIC_IDS));
  });

  it("holds at least one point for every canonical metric", () => {
    for (const metricId of METRIC_IDS) {
      expect(
        store.metricSeries({ metricId }).length,
        `the seed holds no rows for "${metricId}" — every read of it comes back empty`,
      ).toBeGreaterThan(0);
    }
  });

  it("breaks its per-department metrics out over exactly the canonical departments", () => {
    const seen = new Set(store.snapshot().points.map((p) => p.department));
    expect(sorted(withoutAll([...seen]))).toEqual(sorted(DEPARTMENTS));
  });
});
