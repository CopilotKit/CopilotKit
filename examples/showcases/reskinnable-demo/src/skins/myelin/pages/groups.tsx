"use client";

import { useEffect, useMemo } from "react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useMyelinLedger } from "../data/ledger-context";
import { Card, PageHeader, Pill } from "../components/primitives";

/**
 * Groups — who the platform can assign journeys to. The overlap column is the
 * thing that makes program configuration hard ("people in multiple groups"),
 * so it is on screen, not buried in a report.
 */
export function GroupsPage() {
  const { data, loaded, setLocation } = useMyelinLedger();
  useEffect(() => setLocation("groups", null), [setLocation]);

  const rows = useMemo(
    () =>
      data.groups.map((g) => {
        const journeys = data.journeys.filter((j) =>
          j.audienceGroupIds.includes(g.id),
        );
        const members = data.learners.filter((l) => l.groupIds.includes(g.id));
        const alsoIn = new Map<string, number>();
        for (const m of members) {
          for (const other of m.groupIds) {
            if (other !== g.id) alsoIn.set(other, (alsoIn.get(other) ?? 0) + 1);
          }
        }
        return {
          group: g,
          journeys,
          overlaps: [...alsoIn.entries()].map(([id, n]) => ({
            name: data.groups.find((x) => x.id === id)?.name ?? id,
            n,
          })),
        };
      }),
    [data],
  );

  useAgentContext({
    description:
      "What the Groups page is showing: every learner group with its headcount, the journeys assigned to it, and " +
      "how many of its learners also sit in another group.",
    value: JSON.stringify({
      page: "Groups",
      groups: rows.map((r) => ({
        id: r.group.id,
        name: r.group.name,
        learners: r.group.learnerCount,
        journeys: r.journeys.map((j) => `${j.name} (${j.status})`),
        overlaps: r.overlaps.map((o) => `${o.n} also in ${o.name}`),
      })),
      totalLearners: data.groups.reduce((s, g) => s + g.learnerCount, 0),
    }),
  });

  if (!loaded) return <p className="text-sm text-ink-muted">Loading groups…</p>;

  return (
    <div>
      <PageHeader
        title="Groups"
        subtitle={`${data.groups.length} groups across Harvest Lane's three stores · ${data.groups
          .reduce((s, g) => s + g.learnerCount, 0)
          .toLocaleString()} learners`}
      />
      <Card className="p-0">
        <table className="w-full text-[0.8rem]">
          <thead>
            <tr className="border-b border-hairline text-left text-[0.68rem] uppercase tracking-wide text-ink-muted">
              <th className="px-5 py-3 font-medium">Group</th>
              <th className="px-5 py-3 text-right font-medium">Learners</th>
              <th className="px-5 py-3 font-medium">Journeys</th>
              <th className="px-5 py-3 font-medium">Also in another group</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.group.id}
                className="border-b border-hairline/60 last:border-0"
              >
                <td className="px-5 py-3">
                  <div className="font-semibold text-ink">{r.group.name}</div>
                  <div className="text-[0.7rem] text-ink-muted">
                    {r.group.department}
                  </div>
                </td>
                <td className="my-num px-5 py-3 text-right font-semibold text-ink">
                  {r.group.learnerCount}
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap gap-1">
                    {r.journeys.length ? (
                      r.journeys.map((j) => (
                        <Pill
                          key={j.id}
                          tone={
                            j.status === "published" ? "positive" : "accent"
                          }
                        >
                          {j.name}
                        </Pill>
                      ))
                    ) : (
                      <span className="text-[0.72rem] text-ink-muted">—</span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-3">
                  {r.overlaps.length ? (
                    r.overlaps.map((o) => (
                      <div key={o.name} className="text-[0.74rem] text-ink">
                        <span className="my-num font-semibold">{o.n}</span> also
                        in {o.name}
                      </div>
                    ))
                  ) : (
                    <span className="text-[0.72rem] text-ink-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
