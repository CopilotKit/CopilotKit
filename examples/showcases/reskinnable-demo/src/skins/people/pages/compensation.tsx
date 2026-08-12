"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, FileWarning, Loader2 } from "lucide-react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { cn } from "@/lib/utils";
import { usePeopleLedger } from "../data/ledger-context";
import {
  bandPosition,
  formatPercent,
  formatSalary,
  isOutOfBand,
} from "../data/derive";
import {
  BAND_EXCEPTION_CODES,
  exceptionCodeLabel,
} from "../data/band-exception-codes";
import type { CompRequest } from "../data/types";
import { BandLadder } from "../components/band-ladder";
import { Monogram } from "../components/monogram";
import {
  EmptyState,
  Metric,
  PageHeader,
  Panel,
  Pill,
  SectionLabel,
} from "../components/primitives";
import { useRecording } from "../components/recording-context";

/**
 * BEAT 6 — the human demonstration surface.
 *
 * This card is where a person shows Rowan how to get an out-of-band promotion
 * approved: try Approve (refused, symptom only) → file a band exception under
 * some code → finalize it → Approve again. Every one of those is a real REST
 * call against the real gate; nothing here is staged.
 *
 * The refusal text is rendered VERBATIM from the server. Do not "improve" it
 * with a hint about band exceptions — the whole beat rests on the fix not being
 * discoverable from the error, and a helpful message here would leak it to the
 * audience even if the agent never saw it.
 */
function CompRequestCard({ request }: { request: CompRequest }) {
  const { data, refresh } = usePeopleLedger();
  const { logStep } = useRecording();
  const [busy, setBusy] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);
  const [code, setCode] = useState(BAND_EXCEPTION_CODES[0].code);
  const [justification, setJustification] = useState("");

  const employee = data.employees.find((e) => e.id === request.employeeId);
  const band = data.bands.find((b) => b.level === request.proposedLevel);
  const exceptions = data.bandExceptions.filter(
    (x) => x.compRequestId === request.id,
  );
  const overBy =
    band && request.requestedSalary > band.max
      ? request.requestedSalary - band.max
      : 0;

  const approve = async () => {
    setBusy("approve");
    setRefusal(null);
    try {
      const res = await fetch(
        `/api/people/v1/comp-requests/${request.id}/approve`,
        { method: "POST" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRefusal(body?.message ?? `Refused (HTTP ${res.status})`);
        logStep(`Approve refused for ${employee?.name ?? request.employeeId}`);
        return;
      }
      logStep(
        `Approved the promotion for ${employee?.name ?? request.employeeId}`,
      );
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const fileException = async () => {
    setBusy("file");
    try {
      const res = await fetch("/api/people/v1/band-exceptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          compRequestId: request.id,
          code,
          justification:
            justification.trim() || "Filed from the compensation desk.",
        }),
      });
      if (!res.ok) return;
      // Record the code the human ACTUALLY chose. If they picked a decoy, the
      // recording says so and the approve below still fails — which is the
      // honest demonstration, and a better one than a recorder that silently
      // corrects the person it is supposed to be learning from.
      logStep(`Filed a band exception under ${code}`, code);
      setFiling(false);
      setJustification("");
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const finalize = async (exceptionId: string, exceptionCode: string) => {
    setBusy(exceptionId);
    try {
      const res = await fetch(
        `/api/people/v1/band-exceptions/${exceptionId}/finalize`,
        { method: "POST" },
      );
      if (!res.ok) return;
      logStep(`Finalized the ${exceptionCode} exception`, exceptionCode);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const decline = async () => {
    setBusy("decline");
    try {
      await fetch(`/api/people/v1/comp-requests/${request.id}/decline`, {
        method: "POST",
      });
      logStep(
        `Declined the request for ${employee?.name ?? request.employeeId}`,
      );
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  if (!employee) return null;
  const settled = request.status !== "pending";

  return (
    <article
      className={cn(
        "rounded-lg border bg-surface p-4",
        overBy ? "border-negative/30" : "border-hairline",
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <Monogram name={employee.name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">{employee.name}</h3>
            <Pill tone="brand">
              {employee.level} → {request.proposedLevel}
            </Pill>
            {overBy ? (
              <Pill tone="negative">
                <AlertTriangle className="h-3 w-3" />
                {formatSalary(overBy)} over band
              </Pill>
            ) : (
              <Pill tone="positive">In band</Pill>
            )}
            {request.status === "approved" ? (
              <Pill tone="positive">Approved</Pill>
            ) : null}
            {request.status === "declined" ? <Pill>Declined</Pill> : null}
          </div>
          <p className="mt-1 text-[0.78rem] text-ink-muted">{request.reason}</p>
          <p className="rowan-num mt-1 text-[0.75rem] text-ink">
            {formatSalary(request.currentSalary)}{" "}
            <span className="text-ink-muted">→</span>{" "}
            <span className="font-semibold">
              {formatSalary(request.requestedSalary)}
            </span>
            {band ? (
              <span className="ml-2 text-[0.7rem] text-ink-muted">
                {request.proposedLevel} band {formatSalary(band.min)}–
                {formatSalary(band.max)}
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-[0.68rem] text-ink-muted">
            Submitted by {request.submittedBy}
          </p>
        </div>
      </div>

      {exceptions.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {exceptions.map((exception) => (
            <li
              key={exception.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-surface-muted px-2.5 py-1.5 text-[0.72rem]"
            >
              <FileWarning className="h-3.5 w-3.5 text-ink-muted" />
              <span className="font-medium text-ink">
                {exceptionCodeLabel(exception.code)}
              </span>
              <span className="rowan-num text-ink-muted">{exception.code}</span>
              {exception.status === "approved" ? (
                <Pill tone="positive">
                  <Check className="h-3 w-3" />
                  Finalized
                </Pill>
              ) : (
                <button
                  type="button"
                  onClick={() => void finalize(exception.id, exception.code)}
                  disabled={busy === exception.id}
                  className="ml-auto rounded-md border border-brand/40 bg-brand-soft px-2 py-0.5 font-semibold text-brand disabled:opacity-50"
                >
                  {busy === exception.id ? "Finalizing…" : "Finalize"}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {refusal ? (
        <p
          role="status"
          className="mt-3 flex items-start gap-2 rounded-md border border-negative/30 bg-negative-soft px-3 py-2 text-[0.75rem] text-negative"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{refusal}</span>
        </p>
      ) : null}

      {filing ? (
        <div className="mt-3 space-y-2 rounded-md border border-hairline bg-surface-muted p-3">
          <label className="block">
            <span className="mb-1 block text-[0.7rem] font-medium text-ink-muted">
              Exception code
            </span>
            <select
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-[0.78rem] text-ink outline-none focus:border-brand/50"
            >
              {BAND_EXCEPTION_CODES.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.code} — {entry.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[0.68rem] text-ink-muted">
              {BAND_EXCEPTION_CODES.find((e) => e.code === code)?.blurb}
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-[0.7rem] font-medium text-ink-muted">
              Justification
            </span>
            <textarea
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
              rows={2}
              placeholder="What is on file to support this?"
              className="w-full resize-none rounded-md border border-hairline bg-surface px-2 py-1.5 text-[0.78rem] text-ink outline-none placeholder:text-ink-muted focus:border-brand/50"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void fileException()}
              disabled={busy === "file"}
              className="rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-brand-foreground disabled:opacity-50"
            >
              {busy === "file" ? "Filing…" : "File exception"}
            </button>
            <button
              type="button"
              onClick={() => setFiling(false)}
              className="rounded-md border border-hairline px-3 py-1.5 text-[0.75rem] text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {!settled ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void approve()}
            disabled={busy === "approve"}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-brand-foreground disabled:opacity-50"
          >
            {busy === "approve" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            Approve
          </button>
          {!filing ? (
            <button
              type="button"
              onClick={() => setFiling(true)}
              className="rounded-md border border-hairline px-3 py-1.5 text-[0.75rem] font-medium text-ink hover:bg-surface-muted"
            >
              File band exception
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void decline()}
            disabled={busy === "decline"}
            className="rounded-md border border-hairline px-3 py-1.5 text-[0.75rem] text-ink-muted hover:text-ink disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function CompensationPage() {
  const { data } = usePeopleLedger();
  const [level, setLevel] = useState<string>("All");

  const outOfBand = useMemo(
    () => data.employees.filter((e) => isOutOfBand(data.bands, e)),
    [data.employees, data.bands],
  );

  const ladderPeople = useMemo(
    () =>
      level === "All"
        ? data.employees
        : data.employees.filter((e) => e.level === level),
    [data.employees, level],
  );

  const pendingComp = data.compRequests.filter((c) => c.status === "pending");

  const medianPosition = useMemo(() => {
    const ratios = data.employees
      .map((e) => bandPosition(data.bands, e.baseSalary, e.level)?.ratio)
      .filter((r): r is number => r !== undefined)
      .sort((a, b) => a - b);
    if (ratios.length === 0) return 0;
    return ratios[Math.floor(ratios.length / 2)];
  }, [data.employees, data.bands]);

  // ── BEAT 3b ──────────────────────────────────────────────────────────────
  // The Compensation page's own on-screen readable. Note it reports positions
  // as PERCENTAGES of band, which is also the shape beat 4's seeded preference
  // asks for — so when the agent recalls that preference, the numbers it needs
  // are already in the form it was told to use.
  useAgentContext({
    description:
      "The Compensation page the user is currently viewing: the band ladder, " +
      "the active level filter, everyone's position in band, who is outside " +
      "their band, and the pending compensation requests.",
    value: JSON.stringify({
      page: "compensation",
      filters: { level },
      bands: data.bands,
      outOfBand: outOfBand.map((e) => {
        const pos = bandPosition(data.bands, e.baseSalary, e.level);
        return {
          name: e.name,
          level: e.level,
          baseSalary: e.baseSalary,
          side: pos?.side,
        };
      }),
      visiblePeople: ladderPeople.slice(0, 25).map((e) => {
        const pos = bandPosition(data.bands, e.baseSalary, e.level);
        return {
          name: e.name,
          level: e.level,
          team: e.team,
          positionInBand: pos
            ? pos.outOfBand
              ? `${pos.side} band`
              : formatPercent(pos.ratio)
            : null,
        };
      }),
      pendingCompRequests: pendingComp.map((c) => ({
        id: c.id,
        employee: data.employees.find((e) => e.id === c.employeeId)?.name,
        reason: c.reason,
        currentSalary: c.currentSalary,
        requestedSalary: c.requestedSalary,
        proposedLevel: c.proposedLevel,
        withinBand: (() => {
          const band = data.bands.find((b) => b.level === c.proposedLevel);
          return band
            ? c.requestedSalary >= band.min && c.requestedSalary <= band.max
            : null;
        })(),
      })),
    }),
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Compensation"
        subtitle="Every person placed inside their own band, so levels compare like for like."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="People banded" value={String(data.employees.length)} />
        <Metric
          label="Outside their band"
          value={String(outOfBand.length)}
          tone={outOfBand.length ? "negative" : "positive"}
        />
        <Metric
          label="Median position in band"
          value={formatPercent(medianPosition)}
        />
        <Metric
          label="Pending comp requests"
          value={String(pendingComp.length)}
          tone={pendingComp.length ? "gold" : "neutral"}
        />
      </div>

      <Panel className="mb-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <SectionLabel>Band ladder</SectionLabel>
          <div className="flex gap-1">
            {["All", ...data.bands.map((b) => b.level)].map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => setLevel(candidate)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[0.7rem] transition-colors",
                  level === candidate
                    ? "border-brand/50 bg-brand-soft font-semibold text-brand"
                    : "border-hairline bg-surface text-ink-muted hover:text-ink",
                )}
              >
                {candidate}
              </button>
            ))}
          </div>
        </div>
        <BandLadder bands={data.bands} employees={ladderPeople} />
      </Panel>

      <SectionLabel>Compensation requests</SectionLabel>
      {data.compRequests.length === 0 ? (
        <EmptyState
          title="No compensation requests"
          hint="Managers submit promotions and adjustments here; they land in this list for review."
        />
      ) : (
        <div className="space-y-3">
          {data.compRequests.map((request) => (
            <CompRequestCard key={request.id} request={request} />
          ))}
        </div>
      )}
    </div>
  );
}
