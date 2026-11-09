"use client";
import { useState } from "react";
import {
  groupDealsByStage,
  formatCurrency,
  STAGES,
  STAGE_STYLES,
} from "@/lib/crm";
import type { CrmState, Stage } from "@/lib/crm";
import { DealCard } from "./DealCard";
import { cn } from "@/lib/utils";

function StageColumn({
  stage,
  onMoveStage,
  children,
}: {
  stage: Stage;
  onMoveStage?: (dealId: string, stage: Stage) => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <section
      className={cn(
        "w-64 shrink-0",
        over && onMoveStage && "bg-accent/50 ring-1 ring-ring",
      )}
      onDragOver={(e) => {
        if (onMoveStage) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (onMoveStage) {
          const dealId = e.dataTransfer.getData("text/plain");
          if (dealId) onMoveStage(dealId, stage);
        }
      }}
    >
      {children}
    </section>
  );
}

export function PipelineBoard({
  crm,
  selectedDealId,
  onSelect,
  onMoveStage,
}: {
  crm: CrmState;
  selectedDealId: string | null;
  onSelect: (id: string) => void;
  onMoveStage?: (dealId: string, stage: Stage) => void;
}) {
  const grouped = groupDealsByStage(crm.deals);
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {STAGES.map((stage) => {
        const deals = grouped[stage];
        const total = deals.reduce((s, d) => s + d.amount, 0);
        return (
          <StageColumn key={stage} stage={stage} onMoveStage={onMoveStage}>
            <div className="mb-2 flex items-center justify-between">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  STAGE_STYLES[stage],
                )}
              >
                {stage}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {deals.length} · {formatCurrency(total)}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {deals.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  No deals
                </div>
              ) : (
                deals.map((d) => {
                  const account = crm.accounts.find(
                    (a) => a.id === d.accountId,
                  );
                  const contactName = crm.contacts.find(
                    (c) => c.accountId === d.accountId,
                  )?.name;
                  const firstProductId = d.lineItems[0]?.productId;
                  const product = firstProductId
                    ? crm.products.find((p) => p.id === firstProductId)
                    : undefined;
                  const owner = crm.salespeople.find((s) => s.id === d.ownerId);
                  return (
                    <DealCard
                      key={d.id}
                      deal={d}
                      account={account}
                      contactName={contactName}
                      product={product}
                      owner={owner}
                      selected={d.id === selectedDealId}
                      onSelect={onSelect}
                    />
                  );
                })
              )}
            </div>
          </StageColumn>
        );
      })}
    </div>
  );
}
