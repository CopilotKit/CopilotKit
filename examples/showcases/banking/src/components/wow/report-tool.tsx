"use client";

import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { useAuthContext } from "@/components/auth-context";

/** Window event fired whenever a report is filed, so the Reports tab refetches. */
export const REPORTS_CHANGED_EVENT = "banking:reports-changed";

/**
 * Registers the copilot's report-writing capability. Global (mounted in the
 * wrapper) so "prep a report" works from any page. The agent writes the
 * narrative from the data it already sees via useAgentContext; the artifact
 * is filed to the store through the REST layer and lands in the dashboard's
 * Reports tab — durable work product, not a chat bubble.
 */
export function ReportCopilotTools() {
  const { currentUser } = useAuthContext();

  useFrontendTool({
    name: "createReport",
    description:
      "Create a written report and file it in the dashboard's Reports tab. " +
      "Call this whenever the user asks for a report, a summary for the " +
      "board, or a write-up of spend/budgets/transactions. Base the summary " +
      "and highlights on the actual card/policy/transaction data you can " +
      "see. After filing, tell the user the report is waiting in the " +
      "Reports tab of the dashboard.",
    parameters: z.object({
      title: z
        .string()
        .describe('A concise report title, e.g. "Q2 Spend Report".'),
      summary: z
        .string()
        .describe(
          "2-4 sentence executive summary of the findings, grounded in the real data.",
        ),
      highlights: z
        .array(z.string())
        .describe(
          "3-6 short bullet highlights: key figures, risks, and recommendations.",
        ),
    }),
    handler: async ({ title, summary, highlights }) => {
      const res = await fetch("/api/v1/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          summary,
          highlights,
          createdBy: `Copilot, for ${currentUser.name}`,
        }),
      });
      if (!res.ok) {
        return `Could not file the report (HTTP ${res.status}).`;
      }
      const report = await res.json();
      window.dispatchEvent(new Event(REPORTS_CHANGED_EVENT));
      return (
        `Report "${report.title}" filed in the dashboard's Reports tab. ` +
        "Tell the user it is ready there and give a one-line summary — do not repeat the whole report in chat."
      );
    },
  });

  return null;
}

export default ReportCopilotTools;
