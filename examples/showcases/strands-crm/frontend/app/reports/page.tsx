"use client";
import { useMemo } from "react";
import Link from "next/link";
import { useCrmContext } from "@/components/crm-context";
import { KpiStrip } from "@/components/KpiStrip";
import { AreaChart, BarList, DonutChart } from "@/components/charts";
import { Card } from "@/components/ui/card";
import {
  formatCurrency,
  revenueByCategory,
  salesOverTime,
  STAGES,
} from "@/lib/crm";
import type { CrmState } from "@/lib/crm";
import { FileText, UsersRound, ArrowUpRight } from "lucide-react";

/** Pipeline value (open + closed) by stage, from the live snapshot. */
function pipelineByStage(crm: CrmState) {
  return STAGES.map((stage) => {
    const deals = crm.deals.filter((d) => d.stage === stage);
    return {
      label: stage,
      value: deals.reduce((s, d) => s + d.amount, 0),
      secondary: `${deals.length} ${deals.length === 1 ? "deal" : "deals"}`,
    };
  }).filter((row) => row.value > 0);
}

const SUBPAGES = [
  {
    href: "/reports/weekly",
    label: "Weekly Reports",
    desc: "Generated weekly sales reports.",
    icon: FileText,
  },
  {
    href: "/reports/team",
    label: "Team Reports",
    desc: "Team-wide performance & leaderboard.",
    icon: UsersRound,
  },
];

export default function ReportsPage() {
  const { crm } = useCrmContext();

  const categoryData = useMemo(
    () =>
      revenueByCategory(crm).map((c) => ({
        label: c.category,
        value: c.value,
      })),
    [crm],
  );
  const categoryTotal = categoryData.reduce((s, c) => s + c.value, 0);
  const salesTrend = useMemo(() => salesOverTime(crm), [crm]);
  const stageData = useMemo(() => pipelineByStage(crm), [crm]);

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live pipeline analytics. Open Weekly or Team reports for the details
            your assistant generates.
          </p>
        </div>

        {/* ---- Report sub-pages ---- */}
        <div className="grid gap-4 sm:grid-cols-2">
          {SUBPAGES.map(({ href, label, desc, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-center gap-4 rounded-xl border border-border bg-card p-5 transition hover:border-primary/40 hover:shadow-sm"
            >
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-secondary">
                <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 font-medium text-foreground">
                  {label}
                  <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
                </div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </div>
            </Link>
          ))}
        </div>

        {/* ---- Live analytics from the current CRM snapshot ---- */}
        <section className="space-y-4">
          <KpiStrip crm={crm} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="gap-3 py-5">
              <div className="px-6 text-sm font-semibold">
                Open pipeline by category
              </div>
              <div className="px-6">
                <DonutChart
                  data={categoryData}
                  centerLabel="open pipeline"
                  centerValue={Intl.NumberFormat("en-US", {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(categoryTotal)}
                />
              </div>
            </Card>

            <Card className="gap-3 py-5">
              <div className="px-6 text-sm font-semibold">
                Bookings over time
              </div>
              <div className="px-2">
                <AreaChart
                  data={salesTrend.map((p) => ({
                    label: p.label,
                    value: p.bookings,
                  }))}
                />
              </div>
            </Card>

            <Card className="gap-3 py-5 lg:col-span-2">
              <div className="px-6 text-sm font-semibold">
                Pipeline value by stage
              </div>
              <div className="px-6">
                <BarList data={stageData} format={formatCurrency} />
              </div>
            </Card>
          </div>
        </section>
      </div>
    </div>
  );
}
