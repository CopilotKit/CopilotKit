"use client";

import { useMemo, useState } from "react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { cn } from "@/lib/utils";
import { useRecording } from "@/shell/teach";
import { useExecLedger } from "../data/ledger-context";
import type {
  BoardPack,
  DashboardId,
  MetricId,
  NarrativeCode,
} from "../data/types";

/**
 * BEAT 6 — the OPERATOR-FACING variance-narrative filing form, and the Board
 * Packs page it lives on.
 *
 * `NarrativeFilingForm` below is the ONE surface in this skin where the
 * narrative-code vocabulary (VAR-TIMING / VAR-ONEOFF / VAR-FX / VAR-PLAN) may
 * legitimately appear, mirroring logistics' escalation-form.tsx beat for
 * beat: `agent.ts`'s `fileVarianceNarrativeTool` takes a free `z.string()` for
 * `code`, names none of these four in its description or in the EXEC_PROMPT,
 * and `isNarrativeCode`'s rejection set lives inside a function body rather
 * than a module-scope catalogue — Vantage learns which code clears a breach
 * only by watching the operator pick one HERE. Importing this vocabulary into
 * `agent.ts` (or any other agent-facing file) is exactly the leak beat 6
 * exists to prevent; this page is the sanctioned exception.
 *
 * The `useAgentContext` readable below is the other half of the same
 * discipline. Following logistics' own precedent — `control-tower.tsx`'s
 * readable omits the escalation-code vocabulary entirely, and even its
 * Decision Log (`decisions.tsx`) has no `code` field on a filed decision at
 * all — this page's readable lists filed narratives by metric and period
 * only. It carries no `code`, for an already-filed narrative or otherwise:
 * a readable that named the code only on filed rows would still teach the
 * model the closed vocabulary, one value at a time, across a demo's worth of
 * filings.
 *
 * Publishing itself is NOT driven from this page. Per the Wave 3 ruling, the
 * countersign PIN is the chat HITL card's job (a later beat): this page only
 * renders each dashboard's published packs and a hint to ask Vantage to
 * publish. Whether a dashboard's NEXT publish attempt would be blocked on
 * unexplained variance is not knowable client-side without duplicating the
 * gate, so this page does not claim to know it — it lists what has already
 * cleared the gate, nothing more.
 */

/** Human labels for the withheld narrative-code vocabulary. Do not export. */
const NARRATIVE_CODES: readonly NarrativeCode[] = [
  "VAR-TIMING",
  "VAR-ONEOFF",
  "VAR-FX",
  "VAR-PLAN",
];

const NARRATIVE_CODE_LABELS: Record<NarrativeCode, string> = {
  "VAR-TIMING": "Timing shift",
  "VAR-ONEOFF": "One-off event",
  "VAR-FX": "Currency",
  "VAR-PLAN": "Plan error",
};

const DASHBOARD_IDS: readonly DashboardId[] = ["ceo", "cfo"];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function BoardPacksPage() {
  const { snapshot } = useExecLedger();
  const { metricDefs, narratives, packs, dashboards } = snapshot;

  const metricLabel = useMemo(() => {
    const byId = new Map(metricDefs.map((d) => [d.id, d.label]));
    return (id: MetricId) => byId.get(id) ?? id;
  }, [metricDefs]);

  const packsByDashboard = useMemo(() => {
    const grouped = new Map<DashboardId, BoardPack[]>();
    for (const id of DASHBOARD_IDS) grouped.set(id, []);
    for (const pack of packs) {
      grouped.get(pack.dashboardId)?.push(pack);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
    }
    return grouped;
  }, [packs]);

  const filedNarratives = useMemo(
    () => [...narratives].sort((a, b) => (a.filedAt < b.filedAt ? 1 : -1)),
    [narratives],
  );

  // ── BEAT 3b — what is on screen, WITHOUT the withheld code vocabulary ─────
  // See the module doc comment: this list omits `code` for every narrative,
  // filed or not, matching logistics' precedent that no page-level readable
  // ever carries the closed catalogue a beat-6 form gates on.
  useAgentContext({
    description:
      "What is on the Board Packs screen right now. `dashboards` lists each " +
      "dashboard's published packs, newest first. `narrativesFiled` lists " +
      "every variance narrative filed so far, by metric and period, newest " +
      "first — it deliberately omits the narrative's code, which is withheld " +
      "from you on every channel.",
    value: JSON.stringify({
      page: "Board Packs",
      dashboards: DASHBOARD_IDS.map((id) => ({
        dashboardId: id,
        title: dashboards[id]?.title ?? id,
        publishedPacks: (packsByDashboard.get(id) ?? []).map((pack) => ({
          publishedAt: pack.publishedAt,
          blockCount: pack.blockIds.length,
          narrativeCount: pack.narrativeIds.length,
        })),
      })),
      narrativesFiled: filedNarratives.map((n) => ({
        metric: metricLabel(n.metricId),
        period: n.period,
        source: n.source,
        filedAt: n.filedAt,
      })),
    }),
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Board Packs
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Published packs for both dashboards, and the variance narratives on
          file.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Published packs
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {DASHBOARD_IDS.map((id) => (
            <PublishedPacksCard
              key={id}
              title={dashboards[id]?.title || `${id.toUpperCase()} dashboard`}
              packs={packsByDashboard.get(id) ?? []}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          File a variance narrative
        </h2>
        <NarrativeFilingForm />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Narratives filed
        </h2>
        <FiledNarrativesList />
      </section>
    </div>
  );
}

/**
 * One dashboard's publish state, rendered honestly: a list of what has
 * already published, and a hint pointing at the chat rather than a PIN
 * input. Whether the NEXT publish attempt would be blocked on unexplained
 * variance is a server-side gate this page does not re-implement, so it says
 * nothing about it either way.
 */
function PublishedPacksCard({
  title,
  packs,
}: {
  title: string;
  packs: BoardPack[];
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-4 shadow-soft">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {packs.length === 0 ? (
        <p className="text-xs text-ink-muted">Nothing published yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {packs.map((pack) => (
            <li
              key={pack.id}
              className="rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-xs text-ink"
            >
              <div className="font-medium">{formatDate(pack.publishedAt)}</div>
              <div className="text-ink-muted">
                {pack.blockIds.length} block
                {pack.blockIds.length === 1 ? "" : "s"} ·{" "}
                {pack.narrativeIds.length} narrative
                {pack.narrativeIds.length === 1 ? "" : "s"}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-muted">
        Ask Vantage to publish this dashboard when it&rsquo;s ready.
      </p>
    </div>
  );
}

/** The result line the form shows the operator. `tone` drives the colour only. */
interface Note {
  tone: "positive" | "negative";
  text: string;
}

function NarrativeFilingForm() {
  const { snapshot, fileNarrative } = useExecLedger();
  const { metricDefs, points } = snapshot;
  // BEAT 6 — brackets this write with the shell's recorder, so a filing made
  // here WHILE `awaitDemonstration`'s card is open (`../tools.tsx`) is
  // captured as the demonstration: `logStep`'s second argument carries the
  // narrative code as DATA, and `getDemonstratedCode()` reads the last CODED
  // step. This bracket exists so the feed and the glow still appear when an
  // operator files a narrative off their own bat, with no chat involved (see
  // keel's `variance-form.tsx`, ~lines 44–46, for the same rationale); during
  // a demonstration it nests INSIDE `DemonstrationCard`'s outer bracket
  // (`../tools.tsx`), which the shell's recorder ref-counts
  // (`src/shell/teach/recording.tsx`) so both stay open across the
  // presenter's whole demonstration rather than the inner bracket clearing
  // the feed the moment this form's own write finishes. This form is the ONE
  // place Vantage's teach chain can ever learn a code from, mirroring
  // keel's `variance-form.tsx` and airline's `fare-exception-form.tsx`.
  const { beginRecording, endRecording, logStep } = useRecording();

  const periods = useMemo(
    () => [...new Set(points.map((p) => p.period))].sort().reverse(),
    [points],
  );

  const [metricId, setMetricId] = useState<MetricId>(
    () => metricDefs[0]?.id ?? "revenue",
  );
  const [period, setPeriod] = useState<string>(() => periods[0] ?? "");
  const [code, setCode] = useState<NarrativeCode>(NARRATIVE_CODES[0]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const onSubmit = async () => {
    setBusy(true);
    setNote(null);
    beginRecording();
    logStep(`Opened the narrative filing form for ${metricId} ${period}`);
    try {
      const filed = await fileNarrative({ metricId, period, code, body });
      setBody("");
      // THE CODED STEP. `getDemonstratedCode()` returns the last step
      // carrying a code, so this one call is what `awaitDemonstration`'s
      // card reads back — the code the presenter actually filed, never the
      // one they may have merely intended to.
      logStep(`Filed the variance narrative as ${filed.code}`, filed.code);
      setNote({
        tone: "positive",
        text: `Filed ${NARRATIVE_CODE_LABELS[filed.code]} for ${filed.metricId} / ${filed.period}.`,
      });
    } catch (err) {
      // Narrated into the feed so a watching agent sees the attempt happened
      // and failed — a silent failure would let it conclude the step
      // succeeded.
      logStep(`The narrative filing failed for ${metricId} ${period}`);
      setNote({
        tone: "negative",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      endRecording();
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-4 shadow-soft">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Metric
          <select
            aria-label="Metric this narrative explains"
            value={metricId}
            onChange={(e) => setMetricId(e.target.value as MetricId)}
            className="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm font-medium text-ink"
          >
            {metricDefs.map((def) => (
              <option key={def.id} value={def.id}>
                {def.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Period
          <select
            aria-label="Period this narrative explains"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm font-medium text-ink"
          >
            {periods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Code
          <select
            aria-label="Narrative code"
            value={code}
            onChange={(e) => setCode(e.target.value as NarrativeCode)}
            className="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm font-medium text-ink"
          >
            {NARRATIVE_CODES.map((c) => (
              <option key={c} value={c}>
                {NARRATIVE_CODE_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        Explanation
        <textarea
          aria-label="Narrative body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="What happened, and why — for the board pack."
          className="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm text-ink"
        />
      </label>

      <div>
        <button
          type="button"
          disabled={busy || !period || !body.trim()}
          onClick={() => void onSubmit()}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
        >
          File narrative
        </button>
      </div>

      {note ? (
        <p
          className={cn(
            "text-xs",
            note.tone === "positive" && "text-positive",
            note.tone === "negative" && "text-negative",
          )}
        >
          {note.text}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The filed-narratives audit log. Unlike the readable above, this is a plain
 * DOM list a human reads — showing the code here is the same on-screen-only
 * exposure the filing form above makes, never a channel the agent reads.
 */
function FiledNarrativesList() {
  const { snapshot } = useExecLedger();
  const { metricDefs, narratives } = snapshot;

  const metricLabel = useMemo(() => {
    const byId = new Map(metricDefs.map((d) => [d.id, d.label]));
    return (id: MetricId) => byId.get(id) ?? id;
  }, [metricDefs]);

  const ordered = useMemo(
    () => [...narratives].sort((a, b) => (a.filedAt < b.filedAt ? 1 : -1)),
    [narratives],
  );

  if (ordered.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
        Nothing filed yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {ordered.map((n) => (
        <li
          key={n.id}
          className="rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink shadow-soft"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">
              {metricLabel(n.metricId)} — {n.period}
            </span>
            <span className="text-xs text-ink-muted">
              {NARRATIVE_CODE_LABELS[n.code]} · {n.source} ·{" "}
              {formatDate(n.filedAt)}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-muted">{n.body}</p>
        </li>
      ))}
    </ul>
  );
}

export default BoardPacksPage;
