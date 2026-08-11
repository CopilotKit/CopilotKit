"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import { useLogistics } from "../actions";
import {
  KpiStrip,
  ExceptionBoard,
  deriveKpiTiles,
  orderExceptionRows,
} from "../components";
import {
  EXCEPTION_FILTERS,
  EXCEPTION_LABELS,
  EXCEPTION_SORTS,
  EXCEPTION_SORT_LABELS,
  STATUS_FILTERS,
  STATUS_LABELS,
  readLevers,
} from "../data/exception-levers";
import type { ExceptionSort } from "../data/exception-levers";
import type { Shipment } from "../data/types";

/**
 * BEAT 3c — the lever surface.
 *
 * Exception class, status, sort and top-N all arrive from the QUERY STRING,
 * which is what lets the agent perform a MANEUVER rather than follow a link: it
 * confirms the levers it is about to pull (`showExceptionQueue` in `../tools`),
 * navigates to `?exception=…&status=…&sort=…&top=…`, and this page reads them
 * back through the one shared record in `../data/exception-levers`.
 *
 * FOUR levers rather than one, on purpose. A single filter looks like a link
 * with extra steps; a class, a status, a sort and a limit applied together look
 * like someone who knows the tool.
 *
 * The controls it set are then VISIBLY tinted, which is the half of the beat
 * that is easy to skip and impossible to recover: if the page merely shows the
 * right rows, the audience sees a filtered list and has to take on faith that
 * the assistant did it. Note it is the CONTROLS that light up, not the rows.
 */

/** Days between planned and current ETA. Never stored — derived from the two dates. */
const slipDays = (s: Shipment) =>
  (Date.parse(s.etaCurrent) - Date.parse(s.etaPlanned)) / 86_400_000;

/** Is the current ETA past the date promised to the customer? Also derived. */
const breachesPromise = (s: Shipment) =>
  Date.parse(s.etaCurrent) > Date.parse(s.slaDate);

/**
 * Typed `Record<ExceptionSort, …>` against the shared lever vocabulary, so a
 * sort `showExceptionQueue` can advertise with no comparator here — or a
 * comparator here the tool cannot ask for — is a TYPE ERROR rather than a lever
 * the confirm card names and the table ignores.
 */
const SORTS: Record<ExceptionSort, (a: Shipment, b: Shipment) => number> = {
  value_desc: (a, b) => b.valueUsd - a.valueUsd,
  eta_slip_desc: (a, b) => slipDays(b) - slipDays(a),
  promise_breach_first: (a, b) =>
    Number(breachesPromise(b)) - Number(breachesPromise(a)),
};

const baseSelect =
  "rounded-md border px-2.5 py-1.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-brand";
// Matches banking's charges.tsx pair — one tinted look across every skin that
// lets the agent reach a control.
const activeSelect =
  "border-brand/50 bg-brand-soft font-semibold text-brand-indigo dark:text-brand-violet";
const idleSelect = "border-hairline bg-surface font-medium text-ink";

export function ControlTowerPage() {
  const { shipments, lanes } = useLogistics();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const router = useRouter();
  const params = useSearchParams();

  // ONE normalized record, the same one the confirm card drew its chips from.
  // An unrecognised value (`?sort=by_vibes`) comes back null, so the view
  // renders exactly as it does with the lever absent and the control stays
  // untinted — never a filter the page claims and does not apply.
  const { exception, status, sort, top } = readLevers(
    new URLSearchParams(params?.toString() ?? ""),
  );

  const setLever = (key: string, value: string | null) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    // Through skinHref, never a hardcoded `/logistics` — under LOCK_SKIN this
    // deploy is served at `/` and a literal prefix would reappear in the address
    // bar on the first click. The Control Tower IS the skin index, so there is
    // no segment to pass.
    router.replace(`${skinHref()}${query ? `?${query}` : ""}`, {
      scroll: false,
    });
  };

  // ONE pipeline, TWO published lengths. `matching` is the count under the
  // levers, BEFORE truncation; `visible` is what the table renders. The caption,
  // the rows and the beat-3b readable all read these — a "Top 10 of 22" caption
  // whose denominator came from `shipments.length` would say the filters did
  // nothing, which is the single number the room is asked to read as proof.
  //
  // `orderExceptionRows` stays the ordering source and runs FIRST, so a sort
  // lever refines worst-first rather than replacing it: `Array.prototype.sort`
  // is stable, so ties inside a lever's comparator fall back to the board's own
  // order instead of the ledger's arbitrary one.
  const { matching, visible } = useMemo(() => {
    // `exception` is an OBJECT ({ code, detail, since }) and OPTIONAL — compare
    // against `.code`. A shipment with no exception is not queue work and is not
    // on this board at all; the `book` figures below are where the whole network
    // is still reported.
    let rows = orderExceptionRows(shipments.filter((s) => s.exception));
    if (exception) rows = rows.filter((s) => s.exception?.code === exception);
    if (status) rows = rows.filter((s) => s.status === status);
    if (sort) rows = [...rows].sort(SORTS[sort]);
    return {
      matching: rows,
      visible: top === null ? rows : rows.slice(0, top),
    };
  }, [shipments, exception, status, sort, top]);

  // ── BEAT 3b, part 2 — what is VISIBLY on this screen ─────────────────────
  // `visible` is the exact array handed to <ExceptionBoard> below, in the exact
  // order it paints, and deriveKpiTiles is the exact function <KpiStrip> builds
  // its tiles from — formatted strings, not raw numbers, so the agent quotes the
  // "67%" the planner can read rather than the 0.6666… behind it. NEVER
  // re-derive or re-slice the source for a readable: a readable listing 5 rows
  // against a panel showing 6 describes the screen wrongly, silently, and a
  // confidently wrong description is indistinguishable from a correct one to
  // the room. `pages/on-screen-readables.test.tsx` asserts that identity
  // against the rendered DOM — a grep cannot see it. In particular there is no
  // `.slice(25)` here: a cap in the readable would have to be a cap the board
  // applies too, and the only cap this page has is the `top` lever.
  //
  // The figures are split by SCOPE and the keys say which is which. `book` is
  // the WHOLE network — the KPI strip is captioned that way on screen and does
  // not move when a lever is pulled — while `matching`/`visible`/`rows` describe
  // the filtered board. They used to sit flat, which was harmless only while
  // nothing filtered; the moment this page gained levers, a book-wide figure
  // beside a filtered row list is a book-wide number presented as a description
  // of the view. `matching` is the caption's denominator, off the same list the
  // caption prints, so the agent can state the figure the room is reading.
  //
  // ONE MECHANICAL CONSTRAINT before rewording any of it: `readables.test.tsx`
  // anchors its omission guard on a `useAgentContext(` call window terminated by
  // the statement's own semicolon, so a SEMICOLON anywhere in the description
  // below ends that window early and fails the guard for reasons the failure
  // message will not explain. Use dashes and full stops.
  useAgentContext({
    description:
      "What is on the Control Tower screen right now. `filters` are the active " +
      "exception, status, sort and top-N levers. `matching` is how many " +
      "exceptions those levers admit before the limit, and `visible` how many " +
      "`rows` remain after it — the rows actually on screen, in the order " +
      "shown. `book` holds whole-network figures the levers do NOT narrow, " +
      "including the KPI tiles as displayed. Never report those as the " +
      "contents of this view.",
    value: JSON.stringify({
      page: "Control Tower",
      filters: { exception, status, sort, top },
      book: {
        kpi_tiles: deriveKpiTiles(shipments),
        totalShipments: shipments.length,
        totalExceptions: shipments.filter((s) => s.exception).length,
      },
      matching: matching.length,
      visible: visible.length,
      rows: visible.map((s) => ({
        reference: s.reference,
        lane: s.laneId,
        carrier: s.carrier,
        value_usd: s.valueUsd,
        // `exception` is an object; emit its code and detail, never the object.
        exception: s.exception?.code ?? null,
        exception_detail: s.exception?.detail ?? null,
        status: s.status,
        eta_planned: s.etaPlanned,
        eta_current: s.etaCurrent,
        promised: s.slaDate,
      })),
    }),
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Control Tower
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Live exceptions across the network, worst first.
        </p>
      </header>

      {/* WHY THE KPI ROW IS NOT VIEW-SCOPED, and why that is said out loud.
          These four tiles are `deriveKpis` over the whole network — the same
          derivation the a2ui brief's StatCards and the OGUI sandbox publish, and
          those surfaces sit on the canvas beside this page. Narrowing them here
          would put two different answers to one question on screen at once. So
          the SCOPE is stated rather than changed: this caption is what stops a
          network-wide figure being read as a description of the filtered board
          below. Silently switching the tiles to `visible` would be the same
          class of lie in the other direction. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          The whole network
        </h2>
        <KpiStrip shipments={shipments} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Exceptions
        </h2>

        {/* The four levers. Each carries the brand tint whenever it is SET in
            the URL rather than sitting at its default — arriving from the
            copilot is exactly that case, so the controls the agent just pulled
            are the ones that light up and the room can see WHAT changed, not
            merely that the page changed. Keyed on the PARSED value, so an
            unrecognised `?sort=banana` tints nothing: it is not a sort the view
            is applying. */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-surface p-3 shadow-soft">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Exception</span>
            <select
              aria-label="Exception class"
              value={exception ?? ""}
              onChange={(e) => setLever("exception", e.target.value)}
              className={cn(baseSelect, exception ? activeSelect : idleSelect)}
            >
              <option value="">All exceptions</option>
              {EXCEPTION_FILTERS.map((code) => (
                <option key={code} value={code}>
                  {EXCEPTION_LABELS[code]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Status</span>
            <select
              aria-label="Shipment status"
              value={status ?? ""}
              onChange={(e) => setLever("status", e.target.value)}
              className={cn(baseSelect, status ? activeSelect : idleSelect)}
            >
              <option value="">Any status</option>
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Sort</span>
            <select
              aria-label="Sort order"
              value={sort ?? ""}
              onChange={(e) => setLever("sort", e.target.value)}
              className={cn(baseSelect, sort ? activeSelect : idleSelect)}
            >
              <option value="">Worst first</option>
              {EXCEPTION_SORTS.map((s) => (
                <option key={s} value={s}>
                  {EXCEPTION_SORT_LABELS[s]}
                </option>
              ))}
            </select>
          </label>

          {/* A number input, not a select: `parseTopLever` honours ANY positive
              integer and the tool schema advertises `.int().positive()`, so a
              fixed 5/10/20 dropdown would be a control unable to represent every
              value the agent can set — the same class of mismatch this whole
              beat is about. */}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Top</span>
            <input
              aria-label="Row limit"
              type="number"
              min={1}
              step={1}
              placeholder="All"
              value={top ?? ""}
              onChange={(e) => setLever("top", e.target.value)}
              className={cn(
                baseSelect,
                "w-24",
                top !== null ? activeSelect : idleSelect,
              )}
            />
          </label>
        </div>

        {/* Numerator and denominator BOTH off the one pipeline above: `visible`
            is what the board renders, `matching` is what the levers admit before
            the limit. Rendered unconditionally so the count on screen is always
            the FILTERED one — commerce printed "Top 10 of 22" from the whole
            book against 13 matching rows, and that number is the single piece of
            evidence the room is asked to read as proof the maneuver landed. */}
        <p className="text-xs text-ink-muted">
          {top !== null
            ? `Top ${visible.length} of ${matching.length} matching exceptions`
            : `${matching.length} matching exception${matching.length === 1 ? "" : "s"}`}
        </p>

        <ExceptionBoard
          shipments={visible}
          lanes={lanes}
          showRank={sort !== null}
        />
      </section>
    </div>
  );
}

export default ControlTowerPage;
