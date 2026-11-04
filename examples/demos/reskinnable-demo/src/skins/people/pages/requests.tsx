"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Clock, X } from "lucide-react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import { usePeopleLedger } from "../data/ledger-context";
import {
  ageInDays,
  REQUEST_KIND_LABEL,
  requestValueLabel,
} from "../data/derive";
import type { PeopleRequest, RequestStatus } from "../data/types";
import { Monogram } from "../components/monogram";
import {
  activeSelectClass,
  EmptyState,
  Metric,
  PageHeader,
  Panel,
  Pill,
  SectionLabel,
} from "../components/primitives";

/**
 * BEAT 3c — the lever surface.
 *
 * Status, sort and top-N are all read from the QUERY STRING, which is what lets
 * the agent perform a maneuver instead of following a link: it confirms the
 * levers it is about to pull, navigates to
 * `?status=pending&sort=aging_desc&top=10`, and this page reads them.
 *
 * The controls it set are then VISIBLY highlighted (`activeSelectClass`), which
 * is the half of the beat that is easy to skip and impossible to recover: if
 * the page merely shows the right rows, the audience sees a filtered list and
 * has to take on faith that the assistant did it. Tinting the controls shows
 * them the assistant reaching into the app's real UI. Note it is the CONTROLS
 * that light up, not the rows.
 */

const SORTS = {
  aging_desc: {
    label: "Oldest first",
    compare: (a: PeopleRequest, b: PeopleRequest) =>
      a.submittedAt.localeCompare(b.submittedAt),
  },
  aging_asc: {
    label: "Newest first",
    compare: (a: PeopleRequest, b: PeopleRequest) =>
      b.submittedAt.localeCompare(a.submittedAt),
  },
  amount_desc: {
    label: "Largest value",
    compare: (a: PeopleRequest, b: PeopleRequest) =>
      (b.amount ?? 0) - (a.amount ?? 0),
  },
} as const;

type SortKey = keyof typeof SORTS;

const STATUSES: (RequestStatus | "all")[] = [
  "all",
  "pending",
  "approved",
  "declined",
];

function statusTone(status: RequestStatus) {
  if (status === "approved") return "positive" as const;
  if (status === "declined") return "neutral" as const;
  return "gold" as const;
}

function RequestRow({
  request,
  rank,
  employeeName,
  onDecide,
}: {
  request: PeopleRequest;
  rank: number | null;
  employeeName: string;
  onDecide: (id: string, status: RequestStatus) => void;
}) {
  const age = ageInDays(request.submittedAt);
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3 last:border-b-0">
      {rank !== null ? (
        <span className="rowan-num w-5 shrink-0 text-right text-[0.7rem] font-semibold text-ink-muted">
          {rank}
        </span>
      ) : null}
      <Monogram name={employeeName} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.8rem] font-medium text-ink">
          {request.summary}
        </p>
        <p className="truncate text-[0.7rem] text-ink-muted">
          {employeeName} · {REQUEST_KIND_LABEL[request.kind]}
        </p>
      </div>
      <span
        className={cn(
          "rowan-num inline-flex items-center gap-1 text-[0.72rem]",
          age >= 21 ? "font-semibold text-negative" : "text-ink-muted",
        )}
        title={`Submitted ${age} days ago`}
      >
        <Clock className="h-3 w-3" />
        {age}d
      </span>
      <span className="rowan-num w-20 shrink-0 text-right text-[0.75rem] font-medium text-ink">
        {requestValueLabel(request)}
      </span>
      <Pill tone={statusTone(request.status)}>{request.status}</Pill>
      {request.status === "pending" ? (
        <span className="flex gap-1">
          <button
            type="button"
            aria-label={`Approve ${request.summary}`}
            onClick={() => onDecide(request.id, "approved")}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline text-positive hover:bg-positive-soft"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Decline ${request.summary}`}
            onClick={() => onDecide(request.id, "declined")}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline text-ink-muted hover:bg-surface-muted"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ) : null}
    </li>
  );
}

export function RequestsPage() {
  const { data, refresh } = usePeopleLedger();
  const router = useRouter();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const params = useSearchParams();
  const [kind, setKind] = useState<string>("all");

  // Levers that can arrive from the URL. `fromUrl` is what drives the highlight
  // — a control the USER clicked should not pretend the assistant set it, so
  // this tracks provenance rather than just the current value.
  const statusParam = params?.get("status") ?? null;
  const sortParam = (params?.get("sort") ?? null) as SortKey | null;
  const topParam = params?.get("top") ?? null;

  const status: RequestStatus | "all" =
    statusParam && STATUSES.includes(statusParam as RequestStatus)
      ? (statusParam as RequestStatus)
      : "all";
  const sort: SortKey =
    sortParam && sortParam in SORTS ? sortParam : "aging_desc";
  const top = topParam ? Math.max(1, Number(topParam) || 0) : null;

  const setLever = (key: string, value: string | null) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (value === null) next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    // Through skinHref, never a hardcoded `/people/requests` — under LOCK_SKIN
    // the deploy is served at `/` and a literal prefix reappears in the address
    // bar on the first click.
    router.push(`${skinHref("requests")}${query ? `?${query}` : ""}`);
  };

  const nameOf = (id: string) =>
    data.employees.find((e) => e.id === id)?.name ?? "Unknown";

  const visible = useMemo(() => {
    let rows = data.requests.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (kind !== "all" && r.kind !== kind) return false;
      return true;
    });
    rows = [...rows].sort(SORTS[sort].compare);
    if (top) rows = rows.slice(0, top);
    return rows;
  }, [data.requests, status, kind, sort, top]);

  const decide = async (id: string, next: RequestStatus) => {
    await fetch(`/api/people/v1/requests/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    await refresh();
  };

  const pending = data.requests.filter((r) => r.status === "pending");
  const oldest = pending.length
    ? Math.max(...pending.map((r) => ageInDays(r.submittedAt)))
    : 0;

  // ── BEAT 3b ──────────────────────────────────────────────────────────────
  // The active levers AND the rows actually rendered after filtering, sorting
  // and slicing — in the order shown. Asked "what's on my screen?" here, the
  // agent must be able to say "the oldest ten pending requests, Tobias's desk
  // at the top, 31 days old" and be right about all of it.
  useAgentContext({
    description:
      "The Requests page the user is currently viewing: the active status " +
      "filter, sort order and top-N limit, and the request rows actually " +
      "visible on screen, in the order shown.",
    value: JSON.stringify({
      page: "requests",
      filters: { status, kind, sort, top },
      pendingTotal: pending.length,
      visibleCount: visible.length,
      rows: visible.slice(0, 25).map((r) => ({
        id: r.id,
        employee: nameOf(r.employeeId),
        kind: REQUEST_KIND_LABEL[r.kind],
        summary: r.summary,
        status: r.status,
        ageDays: ageInDays(r.submittedAt),
        value: requestValueLabel(r),
      })),
    }),
  });

  const showRank = sort === "aging_desc" || sort === "amount_desc";

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Requests"
        subtitle="Time off, equipment, training and role changes, oldest pressure first."
      />

      <div className="mb-5 grid grid-cols-3 gap-3">
        <Metric label="Pending" value={String(pending.length)} tone="gold" />
        <Metric
          label="Oldest pending"
          value={`${oldest}d`}
          tone={oldest >= 21 ? "negative" : "neutral"}
        />
        <Metric
          label="Total this quarter"
          value={String(data.requests.length)}
        />
      </div>

      <Panel className="mb-4" padded={false}>
        <div className="flex flex-wrap items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[0.7rem] font-medium text-ink-muted">
              Status
            </span>
            {STATUSES.map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() =>
                  setLever("status", candidate === "all" ? null : candidate)
                }
                className={activeSelectClass(status === candidate)}
              >
                {candidate}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[0.7rem] font-medium text-ink-muted">
              Sort
            </span>
            {(Object.keys(SORTS) as SortKey[]).map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => setLever("sort", candidate)}
                className={activeSelectClass(sort === candidate)}
              >
                {SORTS[candidate].label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[0.7rem] font-medium text-ink-muted">
              Show
            </span>
            {[null, 5, 10].map((candidate) => (
              <button
                key={String(candidate)}
                type="button"
                onClick={() =>
                  setLever("top", candidate === null ? null : String(candidate))
                }
                className={activeSelectClass(top === candidate)}
              >
                {candidate === null ? "All" : `Top ${candidate}`}
              </button>
            ))}
          </div>

          <label className="ml-auto flex items-center gap-1.5">
            <span className="text-[0.7rem] font-medium text-ink-muted">
              Type
            </span>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              className="rounded-md border border-hairline bg-surface px-2 py-1.5 text-[0.78rem] text-ink outline-none focus:border-brand/50"
            >
              <option value="all">All types</option>
              {Object.entries(REQUEST_KIND_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Panel>

      <SectionLabel>
        {top
          ? `Top ${Math.min(top, visible.length)} of ${data.requests.filter((r) => status === "all" || r.status === status).length}`
          : `${visible.length} requests`}
      </SectionLabel>

      <Panel padded={false}>
        {visible.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="Nothing in this view"
              hint="Widen the status filter or clear the top-N limit to see the rest of the queue."
            />
          </div>
        ) : (
          <ul>
            {visible.map((request, index) => (
              <RequestRow
                key={request.id}
                request={request}
                rank={showRank ? index + 1 : null}
                employeeName={nameOf(request.employeeId)}
                onDecide={(id, next) => void decide(id, next)}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
