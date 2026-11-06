"use client";
import { useMemo, useState } from "react";
import { useCrmContext } from "@/components/crm-context";
import { ReportCard, ReportDetail } from "@/components/reports";
import { Card } from "@/components/ui/card";
import { salesOverTime } from "@/lib/crm";
import { FileText } from "lucide-react";

/**
 * Weekly Reports — the browser for the weekly sales reports the assistant
 * generates. This is the workspace render target for `generate_weekly_report`:
 * the tool persists the report (via STATE_SNAPSHOT), so the newest one is shown
 * selected by default the moment the workspace navigates here.
 */
export default function WeeklyReportsPage() {
  const { crm } = useCrmContext();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Newest first by generatedAt (robust regardless of snapshot order), so a
  // freshly generated report lands at the top and is selected by default.
  const reports = useMemo(
    () =>
      [...crm.reports].sort((a, b) =>
        b.generatedAt.localeCompare(a.generatedAt),
      ),
    [crm.reports],
  );
  const selected =
    reports.find((r) => r.id === selectedId) ?? reports[0] ?? null;
  const salesTrend = useMemo(() => salesOverTime(crm), [crm]);

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Weekly Reports
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The weekly sales reports your assistant generates. Ask it to
            “generate this week’s report.”
          </p>
        </div>

        {reports.length === 0 ? (
          <Card className="items-center gap-3 py-12 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-secondary">
              <FileText className="h-6 w-6 text-muted-foreground" aria-hidden />
            </div>
            <div className="px-6">
              <div className="text-sm font-medium">No reports yet</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Ask the assistant to generate this week&apos;s report.
              </p>
            </div>
          </Card>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <div className="space-y-3">
              {reports.map((report) => (
                <ReportCard
                  key={report.id}
                  report={report}
                  selected={selected?.id === report.id}
                  onSelect={() => setSelectedId(report.id)}
                />
              ))}
            </div>
            <div>
              {selected && (
                <ReportDetail report={selected} salesTrend={salesTrend} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
