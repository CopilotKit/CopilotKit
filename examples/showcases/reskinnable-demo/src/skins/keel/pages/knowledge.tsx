"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { cn } from "@/lib/utils";
import { useKeelHref } from "@/skins/keel/href";
import { useKeelLedger } from "@/skins/keel/ledger-context";
import {
  ATTENTION_FILTERS,
  ATTENTION_FILTER_LABELS,
  REGISTER_SORTS,
  REGISTER_SORT_LABELS,
  SPACE_FILTERS,
  SPACE_LABELS,
  applyRegisterLevers,
  readRegisterLevers,
} from "@/skins/keel/data/register-levers";
import {
  attentionClasses,
  coveragePercent,
  missingEndorsements,
  nullableCoverageShort,
  reviewDebtDays,
} from "@/skins/keel/data/attention";
import {
  RegisterKpiStrip,
  deriveRegisterKpiTiles,
} from "@/skins/keel/components/register-kpis";
import { RegisterBoard } from "@/skins/keel/components/register-board";
import { VarianceFilingForm } from "@/skins/keel/components/variance-form";

/**
 * THE POLICY REGISTER — Harbor Point's document-control board, and the surface
 * beats 3b and 3c both land on.
 *
 * It is served at the `knowledge` segment rather than a new one on purpose: the
 * register IS the parent of `knowledge/<docId>`, the route an agent citation
 * lands on and the second page beat 3b asks "what's on my screen?" about. A
 * separate `register` segment would have split one thing in two and would have
 * needed `resolvePage` (and `navigateTo`'s page enum) to grow a fifth entry for
 * no gain.
 *
 * ── BEAT 3c — the four levers ───────────────────────────────────────────────
 *
 * Space, attention class, sort and top-N all arrive from the QUERY STRING, which
 * is what lets the agent perform a MANEUVER rather than follow a link: it
 * confirms the levers it is about to pull, navigates to
 * `?space=…&attention=…&sort=…&top=…`, and this page reads them back through the
 * ONE shared record in `data/register-levers.ts`. The controls it set are then
 * VISIBLY tinted — note it is the CONTROLS that light up, not the rows, because
 * a filtered list alone asks the room to take on faith that the assistant did
 * it.
 *
 * Four rather than one, deliberately: a single filter looks like a link with
 * extra steps.
 *
 * The lever VOCABULARY, the filtering and the sorting all live in
 * `data/register-levers.ts`, not here. This page renders that module's output.
 * An unrecognised value (`?sort=by_vibes`) normalizes to `null`, so the view
 * renders exactly as it does with the lever absent and the control stays
 * untinted — never a filter the page claims and does not apply.
 *
 * ── BEAT 3b, part 2 — what is VISIBLY on this screen ────────────────────────
 *
 * The readable below reads `view.rows` — the exact array `<RegisterBoard>` is
 * handed — and `deriveRegisterKpiTiles`, the exact function `<RegisterKpiStrip>`
 * renders. Never a second slice or a re-derivation of the same source: a
 * readable listing 5 rows against a panel showing 6 describes the screen
 * wrongly, silently, and a confidently wrong description is indistinguishable
 * from a correct one to the room. `pages/on-screen-readables.test.tsx` asserts
 * that identity against the rendered DOM, element for element and in order —
 * a grep cannot see it.
 *
 * The figures are split by SCOPE and the keys say which is which: `book` is the
 * whole register (the tiles are captioned that way on screen and do not move
 * when a lever is pulled), while `matching` / `visible` / `rows` describe the
 * filtered board.
 */

const baseControl =
  "rounded-md border px-2.5 py-1.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-brand";
// The same tinted pair banking, logistics and commerce use — one "the agent
// reached this control" look across every skin.
const activeControl =
  "border-brand/50 bg-brand-soft font-semibold text-brand-indigo dark:text-brand-violet";
const idleControl = "border-hairline bg-surface font-medium text-ink";

export function KnowledgePage() {
  const keelHref = useKeelHref();
  const router = useRouter();
  const params = useSearchParams();
  const { data, ready } = useKeelLedger();

  /**
   * The instant this board describes — the snapshot's OWN `asOf`, never the
   * wall clock.
   *
   * Three things follow, and all three are the point. The rows, the tiles and
   * the readable are measured at the moment the SERVER measured the register, so
   * "past review date" on screen means what the server would say it means. A
   * test pins the clock by pinning the fixture rather than by faking timers. And
   * reading `Date.now()` here would be an impure call during render — the app's
   * `react-hooks/purity` rule rejects it, correctly: a clock read in a render
   * body produces a different answer every time React happens to re-render.
   *
   * `NaN` before the first snapshot lands, which is honest — the instant is
   * genuinely unknown — and unobservable, because a register with no `asOf` has
   * no documents either. Every consumer of `now` in `data/attention.ts` already
   * treats a non-finite comparison as "not overdue" rather than as a red flag.
   */
  const now = useMemo(() => Date.parse(data.asOf), [data.asOf]);

  // ONE normalized record — the same one a confirm card draws its chips from.
  const levers = useMemo(
    () => readRegisterLevers(new URLSearchParams(params?.toString() ?? "")),
    [params],
  );

  /**
   * ONE pipeline, TWO published lengths. `matching` is the count under the
   * levers BEFORE truncation, `visible` is what the board paints. The caption,
   * the rows and the readable all read this one result — a caption whose
   * denominator came from `documents.length` would read "Top 5 of 9" against 3
   * matching rows, and the single number the room is asked to read as proof of
   * the maneuver would instead say the filters did nothing.
   */
  const view = useMemo(
    () => applyRegisterLevers(data.documents, levers, now),
    [data.documents, levers, now],
  );

  const setLever = (key: string, value: string | null) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    // Through `keelHref`, never a hardcoded `/keel/knowledge` — under LOCK_SKIN
    // this deploy is served at `/` and a literal prefix would reappear in the
    // address bar on the first click.
    router.replace(`${keelHref("knowledge")}${query ? `?${query}` : ""}`, {
      scroll: false,
    });
  };

  // NB: no semicolons in the description. The repo's readable omission guards
  // anchor on a `useAgentContext(` window terminated by the statement's own
  // semicolon, so one inside the prose ends that window early and fails the
  // guard for reasons the failure message will not explain.
  useAgentContext({
    description:
      "What is on the Policy Register screen right now. `filters` are the " +
      "active space, attention, sort and top-N levers. `matching` is how many " +
      "documents those levers admit before the limit, and `visible` how many " +
      "`rows` remain after it — the rows actually on screen, in the order " +
      "shown. `book` holds whole-register figures the levers do NOT narrow, " +
      "including the tiles as displayed. Never report those as the contents of " +
      "this view. An `attestation_coverage_percent` of null means coverage is " +
      "NOT MEASURABLE for that document rather than zero — say so.",
    value: JSON.stringify({
      page: "Policy Register",
      as_of: data.asOf || null,
      filters: {
        space: levers.space,
        attention: levers.attention,
        sort: levers.sort,
        top: levers.top,
      },
      book: {
        kpi_tiles: deriveRegisterKpiTiles(data.documents, now),
        totalDocuments: view.total,
      },
      matching: view.matching,
      visible: view.visible,
      rows: view.rows.map((record) => ({
        ref: record.ref,
        title: record.title,
        owner: record.owner,
        space: record.space,
        status: record.status,
        effective_revision: record.effectiveRevision ?? null,
        review_due: record.reviewDue,
        days_past_review: reviewDebtDays(record, now),
        // null = not measurable, NEVER 0. A model cannot discount what you
        // omitted and will restate a `0` as an all-clear, out loud.
        attestation_coverage_percent: coveragePercent(record),
        attestation_short: nullableCoverageShort(record),
        attention: attentionClasses(record, now),
        pending_revision: record.pendingRevision
          ? {
              label: record.pendingRevision.label,
              stage: record.pendingRevision.stage,
              // The bodies that have not signed. This is the SYMPTOM the release
              // gate is allowed to state — it names who has not endorsed and
              // nothing about how to get past it.
              missing_endorsements: missingEndorsements(record),
            }
          : null,
      })),
    }),
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Policy Register
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Every Harbor Point policy and standard, and where it sits in its
          lifecycle. Open a document to read it, or ask the desk a question to
          get a cited answer.
        </p>
      </header>

      {/* WHY THESE TILES ARE NOT VIEW-SCOPED, said out loud rather than fixed.
          They are `deriveRegisterKpis` over the WHOLE register — the same
          derivation the canvas report and the OGUI sandbox publish, and those
          surfaces sit beside this page. Narrowing them here would put two
          different answers to one question on screen at once. So the SCOPE is
          stated instead, in the caption and under a `book` key in the readable:
          that caption is what stops a register-wide figure being read as a
          description of the filtered board below. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          The whole register
        </h2>
        <RegisterKpiStrip records={data.documents} now={now} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Documents
        </h2>

        {/* The four levers. Each carries the brand tint whenever it is SET in
            the URL rather than sitting at its default — arriving from the copilot
            is exactly that case, so the controls the agent just pulled are the
            ones that light up and the room can see WHAT changed, not merely that
            the page changed. Keyed on the PARSED value, so an unrecognised
            `?space=banana` tints nothing: it is not a filter the view applies. */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-surface p-3 shadow-soft">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Space</span>
            <select
              aria-label="Knowledge space"
              value={levers.space ?? ""}
              onChange={(e) => setLever("space", e.target.value)}
              className={cn(
                baseControl,
                levers.space ? activeControl : idleControl,
              )}
            >
              <option value="">All spaces</option>
              {SPACE_FILTERS.map((space) => (
                <option key={space} value={space}>
                  {SPACE_LABELS[space]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Attention</span>
            <select
              aria-label="Attention class"
              value={levers.attention ?? ""}
              onChange={(e) => setLever("attention", e.target.value)}
              className={cn(
                baseControl,
                levers.attention ? activeControl : idleControl,
              )}
            >
              <option value="">Anything</option>
              {ATTENTION_FILTERS.map((cls) => (
                <option key={cls} value={cls}>
                  {ATTENTION_FILTER_LABELS[cls]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Sort</span>
            <select
              aria-label="Sort order"
              value={levers.sort ?? ""}
              onChange={(e) => setLever("sort", e.target.value)}
              className={cn(
                baseControl,
                levers.sort ? activeControl : idleControl,
              )}
            >
              <option value="">Register order</option>
              {REGISTER_SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {REGISTER_SORT_LABELS[sort]}
                </option>
              ))}
            </select>
          </label>

          {/* A number input, not a select: `parseTopLever` honours ANY positive
              integer, so a fixed 3/5/10 dropdown would be a control unable to
              represent every value the agent can set — the same class of
              mismatch this whole beat is about. */}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Top</span>
            <input
              aria-label="Row limit"
              type="number"
              min={1}
              step={1}
              placeholder="All"
              value={levers.top ?? ""}
              onChange={(e) => setLever("top", e.target.value)}
              className={cn(
                baseControl,
                "w-24",
                levers.top !== null ? activeControl : idleControl,
              )}
            />
          </label>
        </div>

        {/* Numerator and denominator BOTH off the one pipeline above. */}
        <p className="text-xs text-ink-muted">
          {!ready
            ? "Loading the register…"
            : levers.top !== null
              ? `Top ${view.visible} of ${view.matching} matching documents`
              : `${view.matching} matching document${view.matching === 1 ? "" : "s"}`}
        </p>

        <RegisterBoard
          records={view.rows}
          now={now}
          showRank={levers.sort !== null}
        />
      </section>

      {/* ── BEAT 6 — the operator's own variance filing form ──────────────────

          THE SIXTH CHANNEL, AND THE ONE THAT MUST BE OPEN. The variance-code
          catalogue is withheld from the agent through all five of its channels (a
          readable, a schema enum, a tool description, the prompt, a 4xx body); this
          form is the surface a HUMAN reads, and it is how the agent learns which
          code lifts the gate — by WATCHING the operator pick one. A skin that
          withholds perfectly and ships no form has an unlearnable gate.

          ⚠️ IT IS DELIBERATELY ABSENT FROM THE READABLE ABOVE. Describing this
          menu to the agent leaks the catalogue through the one channel
          `withheldGateVocabulary` cannot see (prose), and the demo would then run
          perfectly while proving nothing. Do not add a `variance_form` key to that
          readable, and do not "helpfully" list the codes in the section copy.

          The form imports `VARIANCE_CODE_LABELS` — the sanctioned import site, and
          the reason that export exists. See components/variance-form.tsx. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Publication variances
        </h2>
        <VarianceFilingForm />
      </section>

      {/* ONE SECTION STILL BELONGS HERE AND IS DELIBERATELY NOT IN THIS SLOT, so
          the next author adds it rather than discovering the page has no room. It
          is read straight off `data` — no new fetch, no new hook.

          • BEAT 3d — the filed Impact Briefs (`data.impactBriefs`). The durable
            artifact has to be visible in the APPLICATION: delete the whole thread
            and it is still on this page. That is the beat's only claim, and today
            the brief is visible only on the CANVAS, which dies with the thread. */}
    </div>
  );
}

export default KnowledgePage;
