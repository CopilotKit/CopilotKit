import { DealCard } from "./deal-card";
import type { SalesTodo } from "../../types";
import { SALES_STAGES } from "../../types";

const STAGE_LABELS: Record<SalesTodo["stage"], string> = {
  prospect: "Prospect",
  qualified: "Qualified",
  proposal: "Proposal",
  negotiation: "Negotiation",
  "closed-won": "Closed Won",
  "closed-lost": "Closed Lost",
};

export interface PipelineProps {
  deals: SalesTodo[];
}

export function Pipeline({ deals }: PipelineProps) {
  const dealsByStage = SALES_STAGES.reduce(
    (acc, stage) => {
      acc[stage] = deals.filter((d) => d.stage === stage);
      return acc;
    },
    {} as Record<SalesTodo["stage"], SalesTodo[]>,
  );

  return (
    <div
      data-testid="pipeline-board"
      className="flex gap-4 overflow-x-auto pb-4"
    >
      {SALES_STAGES.map((stage) => {
        const stageDeals = dealsByStage[stage];
        const totalValue = stageDeals.reduce((sum, d) => sum + d.value, 0);

        return (
          <section
            key={stage}
            aria-label={`${STAGE_LABELS[stage]} column`}
            className="flex-shrink-0 w-64 min-w-[16rem]"
          >
            {/* Column header */}
            <div className="mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[var(--foreground)]">
                  {STAGE_LABELS[stage]}
                </h3>
                <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--secondary)] px-2 py-0.5 text-xs font-semibold text-[var(--secondary-foreground)]">
                  {stageDeals.length}
                </span>
              </div>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                ${totalValue.toLocaleString()}
              </p>
            </div>

            {/* Cards */}
            <div className="space-y-3">
              {stageDeals.length === 0 ? (
                <div className="text-center text-xs rounded-lg border-2 border-dashed border-[var(--border)] p-4 text-[var(--muted-foreground)]">
                  No deals
                </div>
              ) : (
                stageDeals.map((deal) => <DealCard key={deal.id} deal={deal} />)
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
