import { z } from "zod";
import * as store from "@/skins/exec/data/store";
import type { MetricId, NarrativeCode } from "@/skins/exec/data/types";

// Zod schemas can't import TS types at runtime, so this mirrors the `MetricId`
// union in ../../../../skins/exec/data/types.ts — but the mirror is checked by
// the compiler rather than by eye. `satisfies Record<MetricId, true>` fails
// BOTH ways: a metric added to the union leaves a key missing here, and a typo
// or a removed metric leaves a key the union does not have. Either drift is a
// typecheck error, not a route that silently 400s a real metric.
const METRIC_IDS = {
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

const metricId = z.enum(Object.keys(METRIC_IDS) as [MetricId, ...MetricId[]]);

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * BEAT 6's WITHHELD VOCABULARY (see `agent.ts`'s `isNarrativeCode` doc
 * comment) applies to this route too: it is the one place an operator files a
 * narrative, and its error body is reachable by anything that can POST here —
 * including an agent probing the endpoint directly. So `code` is validated
 * OUTSIDE the schema entirely: it enters as a bare trimmed `z.string()`, and
 * the membership test below runs only after `safeParse` has already
 * succeeded.
 *
 * That separation is the guarantee, and it is structural. Any zod validator
 * that knows the accepted set publishes it: `z.enum` writes the whole
 * catalogue into `invalid_enum_value`'s `options` AND into its human message
 * ("Invalid enum value. Expected 'VAR-…' | …"), and a `.refine` is one careless
 * message edit away from the same thing. Filtering the serialized issues
 * cannot fix that — an earlier version of this route stripped `options` and
 * claimed the leak was closed, while zod's `message` carried the full list
 * through untouched. The only reliable answer is for no zod issue about `code`
 * to be capable of existing, which is what this schema arranges.
 *
 * The literals below are a REJECTION set, not a vocabulary: nothing derived
 * from them is ever serialized, and the refusal echoes back only the value the
 * caller already sent (useful for a retry) plus hand-written prose.
 */
const isNarrativeCode = (value: string): value is NarrativeCode => {
  // `Record<NarrativeCode, true>` makes this EXHAUSTIVE at compile time, and
  // it is declared inside the predicate — exactly as `agent.ts` does it — so
  // the file holds no module-scope catalogue for anything to reach for.
  const accepted: Record<NarrativeCode, true> = {
    "VAR-TIMING": true,
    "VAR-ONEOFF": true,
    "VAR-FX": true,
    "VAR-PLAN": true,
  };
  return Object.prototype.hasOwnProperty.call(accepted, value);
};

/**
 * A code is a short token like the four the form offers. The bound is a SIZE
 * bound only — it says nothing about which tokens are accepted, so it leaks
 * nothing (see the doc comment above) — and it is generous enough that no
 * plausible code is near it.
 */
const MAX_CODE_LENGTH = 64;

/**
 * Beat 6's body is a paragraph read off the budget memo, so the bound sits
 * well clear of a real explanation. It exists because this store is a
 * process-lifetime singleton that never evicts (see store.ts): unbounded text
 * on an ungated POST is a demo box filling up, and every filed narrative rides
 * back out through the ledger GET on every page load.
 */
const MAX_BODY_LENGTH = 4_000;

const FileNarrativeBody = z.object({
  metricId,
  period: z
    .string()
    .regex(PERIOD_RE, 'Period must be "YYYY-MM" (01–12), e.g. "2026-08".'),
  // Unconstrained in CONTENT — never a `z.enum`, never a `.refine` that knows
  // the accepted set: see the doc comment above. `.trim()` mirrors the agent
  // tool's own trim so a code pasted out of a memo with stray whitespace files
  // instead of being refused, and it runs BEFORE `.min(1)` so a whitespace-only
  // code is refused as the empty field it is rather than reaching the BAD_CODE
  // arm and coming back as `"" is not a code this ledger files under` — a
  // refusal that names nothing and reads as though some other code was tried.
  code: z
    .string()
    .trim()
    .min(1, "Narrative code cannot be empty.")
    .max(MAX_CODE_LENGTH, "Narrative code is too long."),
  // `.trim()` first so a whitespace-only body ("   ") still fails `.min(1)`
  // instead of filing an empty explanation that flips `explained` to true.
  body: z
    .string()
    .trim()
    .min(1, "Narrative body cannot be empty.")
    .max(MAX_BODY_LENGTH, "Narrative body is too long."),
  source: z.enum(["typed", "ingested-memo"]).default("typed"),
});

export const POST = async (req: Request) => {
  const raw = await req.json().catch(() => null);
  const parsed = FileNarrativeBody.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      {
        error: "BAD_REQUEST",
        message: "Invalid narrative payload.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }
  const { code, ...rest } = parsed.data;
  if (!isNarrativeCode(code)) {
    // Word-for-word the refusal `agent.ts` returns from its `isNarrativeCode`
    // arm, so the REST layer and the tool layer tell the operator's agent the
    // same story: names no valid code, says the thing to do is ask.
    return Response.json(
      {
        error: "BAD_CODE",
        message:
          `"${code}" is not a code this ledger files under. You cannot ` +
          `derive one — ask the operator which code applies, or follow a ` +
          `saved procedure that names one, and file it verbatim.`,
      },
      { status: 400 },
    );
  }
  // ── THE (metricId, period) HAS TO NAME A ROW THIS LEDGER HOLDS ────────────
  //
  // The same guard `agent.ts`'s `fileVarianceNarrativeTool` applies, and it has
  // to be HERE too rather than only there: beat 6's filing form POSTs to this
  // route, and its metric/period `<select>`s are not constrained to the pairs
  // the ledger actually covers. Without it a shape-valid period the store holds
  // no point for filed cleanly — 201 "filed", a narrative appended that matches
  // nothing, and `exceptions()` (which pairs narrative to breach by EXACT
  // (metricId, period)) still reporting the breach unexplained. The form showed
  // success while the publish gate went on refusing, with nothing on screen
  // connecting the two. The periods move with the calendar (the seed builds the
  // 24 months ending at the latest CLOSED one), which is exactly why a period
  // cannot be reasoned out and has to be READ.
  //
  // 422, not 400: the payload is well-formed — every field passed its own
  // validator — and what failed is the reference to a row this ledger does not
  // hold, which no amount of reshaping the body fixes.
  const hasPoint = store
    .metricSeries({ metricId: rest.metricId })
    .some((p) => p.period === rest.period);
  if (!hasPoint) {
    // Word-for-word the tool's `NO_LEDGER_POINT` arm, for the same reason the
    // BAD_CODE refusal above is word-for-word its BAD_CODE arm: the REST layer
    // and the tool layer must not tell the operator's agent two different
    // stories about the same rejected filing. Pinned by a test that runs both.
    return Response.json(
      {
        error: "NO_LEDGER_POINT",
        message:
          `This ledger holds no ${rest.metricId} row for ${rest.period}, so ` +
          `nothing was filed. Call get_metrics for ${rest.metricId} to see ` +
          `the periods it actually covers, or list_exceptions for the ones ` +
          `waiting on an explanation, then file against one of those.`,
      },
      { status: 422 },
    );
  }

  const filed = store.fileNarrative({ ...rest, code });
  return Response.json(filed, { status: 201 });
};
