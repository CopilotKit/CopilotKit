import * as store from "@/skins/exec/data/store";
import { buildBudgetMemoPdf } from "@/skins/exec/data/budget-memo-pdf";
import type { BudgetMemoInput } from "@/skins/exec/data/budget-memo-pdf";

/**
 * BEAT 3d — serves the Distribution budget memo the demo attaches.
 *
 * Generated per request from the live ledger, so the period and figures it
 * prints are the period and figures the CFO dashboard shows at the exact same
 * instant. See `data/budget-memo-pdf.ts` for why this is not a static file in
 * `public/`.
 *
 * DELIBERATELY NOT GATED ON `explained`. `store.exceptions()` marks a breach
 * `explained` once a narrative has been filed for its `(metricId, period)`,
 * but the memo is the SOURCE a narrative is filed FROM — gating this route on
 * the very fact it exists to produce would mean the document could only ever
 * be fetched once, and a re-attach after the narrative is already on file
 * (the presenter retrying a demo run, or the agent re-reading the source it
 * cited) would 404 for a reason nobody watching could see.
 */
const METRIC_ID = "opex";
const DEPARTMENT = "distribution";

/**
 * Share of the live overrun attributed to the shipment-timing driver. Fixed
 * (not derived) so the two printed drivers always sum to EXACTLY the live
 * overrun no matter what the seed's numbers happen to be, and kept above
 * one-half so the timing driver is always the larger of the two — the detail
 * that lets the reader infer the narrative code (VAR-TIMING) without the memo
 * ever printing one.
 */
const DRIVER_SPLIT = 0.62;

/** How many days after period close the memo is dated, at the latest. */
const MEMO_DAYS_AFTER_CLOSE = 5;

// en-US for BOTH datelines here and the currency/percentage figures the memo
// itself formats (see `data/budget-memo-pdf.ts`). One document cannot read in
// two locales: a memo that prints "$235,440" in US dollars for a US CFO, and
// spells "recognized" and "Distribution Center", but dates itself
// "5 September 2026" is a document assembled by two different authors — which
// is precisely what it must not look like on stage.
const LONG_DATE = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

/** "YYYY-MM" -> the first of that month, local time — a stable anchor for both formatters below. */
const firstOfPeriod = (period: string): Date => {
  const [year, month] = period.split("-").map(Number);
  return new Date(year, month - 1, 1);
};

const periodLabelFor = (period: string): string =>
  MONTH_YEAR.format(firstOfPeriod(period));

/**
 * The memo's dateline: period close + 5 days, CLAMPED so it can never be in
 * the future.
 *
 * The seed materializes its periods relative to `now`, so on the 1st-4th of
 * any month the latest closed period's close + 5 has not happened yet: on
 * 2 September the memo would date itself 5 September. A finance memo dated
 * three days from now is not a subtle modelling error — it is a visible
 * absurdity on the one document the whole beat asks the room to read, and it
 * would appear on four days of every month with nothing else changing.
 *
 * Clamping to today (rather than shifting to an earlier period, or refusing
 * to serve) keeps the memo reporting on the same live breach the dashboard
 * shows, and stays honest: a memo issued today about a period that closed two
 * days ago is exactly the document a finance business partner would file.
 */
const memoDateFor = (period: string): string => {
  const anchor = firstOfPeriod(period);
  // Last day of `period`'s month: day 0 of the FOLLOWING month.
  const close = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  // Calendar-day arithmetic, NOT `close.getTime() + N * 86_400_000`: adding
  // milliseconds to a local-midnight `Date` silently loses (or gains) a day
  // whenever the window between close and dateline crosses a DST transition
  // (e.g. a "2026-10" close on 31 October plus 5 days crosses America/
  // New_York's fall-back on 1 November, printing 4 November instead of 5).
  // Overflowing `getDate()` past the month's length is exactly what `Date`'s
  // constructor is defined to roll forward correctly.
  const dateline = new Date(
    close.getFullYear(),
    close.getMonth(),
    close.getDate() + MEMO_DAYS_AFTER_CLOSE,
  );
  // Both sides are LOCAL MIDNIGHTS of a calendar day, so comparing them is a
  // calendar-day comparison — no time-of-day and no DST offset can tip it,
  // the way comparing `dateline` against a raw `new Date()` would.
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return LONG_DATE.format(dateline > today ? today : dateline);
};

/**
 * Why the WHOLE body is inside the `try`.
 *
 * This route is beat 3d's document source and the only place a failure here
 * can be diagnosed. A non-2xx aborts the attach chain and alerts the
 * presenter, so the beat fails loudly rather than sending "read the attached
 * memo" with no file attached — which would leave the model to invent the
 * memo's figures and the demo to prove the exact opposite of its point. But
 * the alert can only say "HTTP 500 — see the server logs", so every throw
 * site (the breach/point lookups, `buildBudgetMemoPdf`, the `Response`
 * constructor) is caught here and logged with enough to diagnose from.
 */
export const GET = async () => {
  try {
    const breach = store
      .exceptions()
      .find((e) => e.metricId === METRIC_ID && e.department === DEPARTMENT);
    // Resolve the point by the BREACH'S OWN period rather than relying on two
    // independent "latest period" windows (this route's and `exceptions()`'s)
    // to coincide — a reseed that skews them apart would otherwise silently
    // print the wrong period's figures instead of 404ing.
    const point = breach
      ? store
          .metricSeries({ metricId: METRIC_ID, department: DEPARTMENT })
          .find((p) => p.period === breach.period)
      : undefined;

    if (!breach || !point) {
      // A reseed that stopped breaching Distribution opex — or renamed the
      // department — would otherwise be an INVISIBLE way to disable beat 3d:
      // the pill fetches this route with no lever to change its outcome, so
      // silently returning nothing here would leave "HTTP 404" as the only
      // clue. `console.warn`, not `console.error`: a live ledger with no
      // current breach is a legitimate state, not a fault.
      console.warn(
        `[exec/api] GET budget-memo — no live breach for metricId="${METRIC_ID}" ` +
          `department="${DEPARTMENT}"`,
      );
      return Response.json(
        {
          error: "NOT_FOUND",
          message: "Distribution opex is not currently over plan.",
        },
        { status: 404 },
      );
    }

    // GUARD: the memo's prose is written for an OVERRUN ("closed at X against
    // a plan of Y, an overrun of Z... over plan") and has no sentence for the
    // opposite case. `isBreach` (see `./derive`) trips on the MAGNITUDE of
    // the variance, so an under-plan breach — actual comfortably below plan,
    // by more than the threshold — is a value `exceptions()` can legitimately
    // return. Printing it through this memo would read "an overrun of
    // -$19,440 (9% over plan)": the sign silently stripped by `Math.abs` and
    // the larger driver (shipment timing, per `DRIVER_SPLIT`) now describing
    // the SMALLER share of an under-spend, inverting the VAR-TIMING cue the
    // memo exists to plant. Rather than print that, 404 exactly as if there
    // were no breach at all — true today only because the seed's one opex/
    // distribution breach is over-plan; if a future seed ever makes this
    // metric breach under-plan, this route must stop serving until the memo
    // itself is rewritten with prose for that case.
    if (breach.variancePct <= 0) {
      console.warn(
        `[exec/api] GET budget-memo — refusing to narrate an under-plan ` +
          `breach for metricId="${METRIC_ID}" department="${DEPARTMENT}" ` +
          `period="${breach.period}" (variancePct=${breach.variancePct}); ` +
          "this memo's prose only covers an overrun.",
      );
      return Response.json(
        {
          error: "NOT_FOUND",
          message: "Distribution opex is not currently over plan.",
        },
        { status: 404 },
      );
    }

    // The split is fixed (see `DRIVER_SPLIT`) so these two amounts always sum
    // to exactly `overrunUsd`, whatever that turns out to be for this seed.
    const overrunUsd = point.actual - point.plan;
    const timingUsd = Math.round(overrunUsd * DRIVER_SPLIT);
    const oneOffUsd = overrunUsd - timingUsd;

    const input: BudgetMemoInput = {
      periodLabel: periodLabelFor(breach.period),
      memoDate: memoDateFor(breach.period),
      planUsd: point.plan,
      actualUsd: point.actual,
      variancePct: breach.variancePct,
      timingUsd,
      oneOffUsd,
    };

    const pdf = buildBudgetMemoPdf(input);

    return new Response(pdf as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        // attach-memo.ts prints this same name on the composer chip — the
        // two must stay identical, or the chip shows one filename while the
        // model reads a document served under another.
        "content-disposition":
          'inline; filename="Cascade-Distribution-budget-memo.pdf"',
        // Computed from `now` — the memo date and figures are all read live —
        // so a cached copy would quietly go stale exactly like a static file
        // would.
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error(`[exec/api] GET budget-memo failed:`, error);
    return Response.json(
      { error: "SERVER_ERROR", message: "Could not build the budget memo." },
      { status: 500 },
    );
  }
};
