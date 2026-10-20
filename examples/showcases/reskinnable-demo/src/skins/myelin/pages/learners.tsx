"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMyelinLedger } from "../data/ledger-context";
import {
  LEARNER_SORTS,
  LEARNER_STATUSES,
  SORT_LABEL,
  STATUS_LABEL,
  groupNames,
  learnerRows,
} from "../data/derive";
import type { LearnerFilters, LearnerSort } from "../data/derive";
import type { LearnerStatus } from "../data/types";
import { Card, PageHeader, Pill } from "../components/primitives";

/**
 * Learners — progress on the PUBLISHED journeys. Its filters live in the URL
 * (`?journey=&status=&group=&sort=`), which is what lets the agent's levers
 * card (beat 3c) navigate here with a real view applied, and `?levers=1` marks
 * the controls the agent set so the room can see which ones moved.
 *
 * Learner names are rendered here from the ledger and deliberately left OUT of
 * this page's readable: the agent is told counts, never names.
 */
export function LearnersPage() {
  const { data, loaded, setLocation } = useMyelinLedger();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => setLocation("learners", null), [setLocation]);

  const published = data.journeys.filter((j) => j.status === "published");
  const filters: LearnerFilters = {
    journeyId: params.get("journey") ?? published[0]?.id ?? "",
    status: (LEARNER_STATUSES as readonly string[]).includes(
      params.get("status") ?? "",
    )
      ? (params.get("status") as LearnerStatus)
      : "all",
    groupId: params.get("group") ?? "all",
    sortBy: (LEARNER_SORTS as readonly string[]).includes(
      params.get("sort") ?? "",
    )
      ? (params.get("sort") as LearnerSort)
      : "daysOverdue",
  };
  const byAgent = params.get("levers") === "1";
  // Not memoized: a filter + sort over ~150 sample learners is cheaper than the
  // bookkeeping, and the React Compiler handles the rest.
  const rows = learnerRows(data, filters);
  const journey = data.journeys.find((j) => j.id === filters.journeyId);
  const groupsInJourney = data.groups.filter((g) =>
    journey?.audienceGroupIds.includes(g.id),
  );

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    next.delete("levers");
    router.replace(`${pathname}?${next.toString()}`);
  };

  const counts = LEARNER_STATUSES.map((s) => ({
    status: s,
    n: learnerRows(data, { ...filters, status: s }).length,
  }));

  useAgentContext({
    description:
      "What the Learners page is showing: which published journey's progress is on screen, the filters and sort " +
      "applied, and how many learner rows are visible. Learner NAMES are deliberately not included.",
    value: JSON.stringify({
      page: "Learners",
      journey: journey?.name ?? null,
      filters: {
        status: filters.status,
        group:
          filters.groupId === "all"
            ? "all groups"
            : groupNames(data.groups, [filters.groupId])[0],
        sort: SORT_LABEL[filters.sortBy],
      },
      rowsVisible: rows.length,
      statusCountsForThisJourneyAndGroup: Object.fromEntries(
        counts.map((c) => [c.status, c.n]),
      ),
      mostOverdueDays: rows[0]?.daysOverdue ?? 0,
    }),
  });

  if (!loaded)
    return <p className="text-sm text-ink-muted">Loading learners…</p>;

  const lever = (on: boolean) =>
    byAgent && on ? "ring-2 ring-brand-violet/60 border-brand-violet" : "";

  return (
    <div>
      <PageHeader
        title="Learners"
        subtitle="Progress on live journeys. Names are shown to you here and never shared with the assistant."
        right={
          byAgent ? (
            <Pill tone="accent">
              <Sparkles className="h-3 w-3" /> View set by Myelin
            </Pill>
          ) : null
        }
      />
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filters.journeyId}
            onChange={(e) => set("journey", e.target.value)}
            className={cn(
              "rounded-md border border-hairline bg-surface px-2 py-1.5 text-[0.78rem]",
              lever(params.has("journey")),
            )}
          >
            {published.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
          <select
            value={filters.groupId}
            onChange={(e) => set("group", e.target.value)}
            className={cn(
              "rounded-md border border-hairline bg-surface px-2 py-1.5 text-[0.78rem]",
              lever(params.has("group")),
            )}
          >
            <option value="all">All groups</option>
            {groupsInJourney.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <select
            value={filters.sortBy}
            onChange={(e) => set("sort", e.target.value)}
            className={cn(
              "rounded-md border border-hairline bg-surface px-2 py-1.5 text-[0.78rem]",
              lever(params.has("sort")),
            )}
          >
            {LEARNER_SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
          <div className="ml-auto flex flex-wrap gap-1">
            {[
              {
                status: "all" as const,
                n: counts.reduce((s, c) => s + c.n, 0),
              },
              ...counts,
            ].map((c) => (
              <button
                key={c.status}
                type="button"
                onClick={() => set("status", c.status)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[0.72rem] font-medium",
                  filters.status === c.status
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-hairline text-ink-muted",
                  lever(params.has("status") && filters.status === c.status),
                )}
              >
                {c.status === "all" ? "All" : STATUS_LABEL[c.status]}{" "}
                <span className="my-num">{c.n}</span>
              </button>
            ))}
          </div>
        </div>
        <table className="mt-4 w-full text-[0.78rem]">
          <thead>
            <tr className="border-b border-hairline text-left text-[0.68rem] uppercase tracking-wide text-ink-muted">
              <th className="py-2 font-medium">Learner</th>
              <th className="py-2 font-medium">Groups</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Progress</th>
              <th className="py-2 text-right font-medium">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 40).map((r) => (
              <tr key={r.learner.id} className="border-b border-hairline/60">
                <td className="py-2 font-medium text-ink">{r.learner.name}</td>
                <td className="py-2 text-ink-muted">
                  {groupNames(data.groups, r.learner.groupIds).join(", ")}
                </td>
                <td className="py-2">
                  <Pill
                    tone={
                      r.status === "overdue"
                        ? "negative"
                        : r.status === "complete"
                          ? "positive"
                          : "muted"
                    }
                  >
                    {STATUS_LABEL[r.status]}
                  </Pill>
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-muted">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${r.percent}%` }}
                      />
                    </div>
                    <span className="my-num text-ink-muted">{r.percent}%</span>
                  </div>
                </td>
                <td className="my-num py-2 text-right text-ink">
                  {r.daysOverdue ? `${r.daysOverdue} d` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 40 ? (
          <p className="mt-2 text-[0.7rem] text-ink-muted">
            Showing 40 of {rows.length}.
          </p>
        ) : null}
        {rows.length === 0 ? (
          <p className="mt-4 text-[0.78rem] text-ink-muted">
            No learners match this view.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
