"use client";
import { BarList } from "@/components/charts";
import { formatCurrency, teamLeaderboard } from "@/lib/crm";
import type { CrmState } from "@/lib/crm";
import { SectionCard } from "./primitives";

/**
 * Section 4 — rep leaderboard ranked by bookings (closed-won $); the secondary
 * caption shows quota attainment. Managers carry a 0 quota, so attainment can
 * read 0% for them — that's expected.
 */
export function TopReps({ crm }: { crm: CrmState }) {
  const rows = teamLeaderboard(crm);
  const data = rows.map((r) => ({
    label: r.name,
    value: r.bookings,
    secondary: `${Math.round(r.attainment * 100)}% of quota`,
  }));

  return (
    <SectionCard title="Top reps">
      <BarList data={data} format={(v) => formatCurrency(v)} />
    </SectionCard>
  );
}
