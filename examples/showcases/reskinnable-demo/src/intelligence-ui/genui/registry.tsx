"use client";

/**
 * Ledgerline's generative UI, by component name, for the trajectory view.
 *
 * Every entry renders the Ledgerline skin's OWN component (src/skins/ledgerline)
 * from the props the recorded tool call carried, the same props the in-app chat
 * drew it from. Nothing is re-drawn by hand. Callbacks are inert: a recording
 * can never confirm, close or open anything.
 */
import type { ReactNode } from "react";
import { CloseStatusCard } from "@/skins/ledgerline/genui/close-status-card";
import { ReviewMatchesCard } from "@/skins/ledgerline/genui/review-card";
import { ReportCard, ReportTable } from "@/skins/ledgerline/genui/cards";
import { LearnedSkillCard } from "@/skins/ledgerline/learned-skills";
import type {
  CloseStatusView,
  ReportRowView,
  ReportView,
  ReviewOutcome,
  ReviewView,
} from "@/skins/ledgerline/genui/views";

type Props = Record<string, unknown>;
const noop = () => undefined;
const refused = async (): Promise<ReviewOutcome> => ({
  ok: false,
  summary: "A recorded trajectory is read-only. Nothing was sent.",
});

export const GENUI: Record<string, (p: Props) => ReactNode> = {
  CloseStatusCard: (p) => (
    <CloseStatusCard view={p as unknown as CloseStatusView} />
  ),
  ReviewMatchesCard: (p) => (
    <ReviewMatchesCard
      view={p as unknown as ReviewView}
      outcome={(p.outcome as ReviewOutcome | undefined) ?? null}
      confirm={refused}
      onSettle={noop}
      onEdit={noop}
    />
  ),
  ReportCard: (p) => <ReportCard report={p.report as ReportView} />,
  ReportTable: (p) => (
    <ReportTable title={String(p.title)} rows={p.rows as ReportRowView[]} />
  ),
  LearnedSkillCard: (p) => (
    <LearnedSkillCard
      name={typeof p.name === "string" ? p.name : null}
      result={p.result}
    />
  ),
};
