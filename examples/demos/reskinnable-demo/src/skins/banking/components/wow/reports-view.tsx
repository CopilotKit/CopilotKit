"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Sparkles } from "lucide-react";
import type { Report } from "@/skins/banking/data/data";
import useCreditCards from "@/skins/banking/actions";

import { ReportCard } from "@/skins/banking/components/wow/report-card";
import { useAskCopilot } from "./use-ask-copilot";
import { REPORTS_CHANGED_EVENT } from "./report-tool";

// Same request the Q2 suggestion pill sends, so the two stay identical by
// construction rather than by someone remembering to update both.
//
// NOTE the deliberate asymmetry: `askCopilot` sends straight to the agent and
// does NOT pass through `skin.onSuggestionSelect`, so this button does not stage
// the bundled PDF invoice the way clicking the suggestion pill does. Same words,
// different beat — the pill is the scripted multimodal demo, this is just "write
// me a report" from the app UI.
import { Q2_REPORT_MESSAGE as REPORT_PILL_MESSAGE } from "@/skins/banking/suggestions";

/**
 * The dashboard's Reports tab: copilot-generated artifacts that outlive the
 * conversation. The narrative (summary + highlights) is the agent's; the
 * charts are rendered live from the same data the narrative describes. Empty
 * state carries the pill that asks the copilot to write the first one.
 */
export function ReportsView() {
  const askCopilot = useAskCopilot();
  const { policies, transactions } = useCreditCards();
  const [reports, setReports] = useState<Report[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/banking/v1/reports");
      if (res.ok) setReports(await res.json());
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener(REPORTS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(REPORTS_CHANGED_EVENT, refresh);
  }, [refresh]);

  if (!loaded) return null;

  if (!reports.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-hairline bg-surface/60 p-12 text-center">
        <FileText className="h-8 w-8 text-ink-muted" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink">No reports yet</p>
          <p className="text-sm text-ink-muted">
            Ask the copilot to write one — it files the finished report right
            here.
          </p>
        </div>
        <button
          type="button"
          data-testid="reports-empty-pill"
          onClick={() => askCopilot(REPORT_PILL_MESSAGE)}
          className="flex items-center gap-2 rounded-full border border-hairline bg-brand-soft/60 px-4 py-2 text-sm font-medium text-brand-indigo transition-colors hover:bg-brand-soft dark:text-brand-violet"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          Prep the Q2 spend report for the board
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {reports.map((report) => (
        <ReportCard
          key={report.id}
          report={report}
          policies={policies}
          transactions={transactions}
        />
      ))}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => askCopilot(REPORT_PILL_MESSAGE)}
          className="flex items-center gap-2 rounded-full border border-hairline bg-brand-soft/60 px-3 py-1.5 text-xs font-medium text-brand-indigo transition-colors hover:bg-brand-soft dark:text-brand-violet"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Ask for another report
        </button>
      </div>
    </div>
  );
}

export default ReportsView;
