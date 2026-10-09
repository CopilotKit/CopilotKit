"use client";
import { useCrmContext } from "@/components/crm-context";
import { PipelineBoard } from "@/components/PipelineBoard";
import { Skeleton } from "@/components/ui/skeleton";

export default function PipelinePage() {
  const { crm, loading, selectedDealId, setSelectedDealId, moveDealStage } =
    useCrmContext();
  return (
    <div className="h-full overflow-auto p-6">
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Drag deals between stages to update them.
          </p>
        </div>
        {loading ? (
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="w-64 shrink-0 space-y-2">
                <Skeleton className="h-5 w-32 rounded-full" />
                <Skeleton className="h-24 w-full rounded-xl" />
                <Skeleton className="h-24 w-full rounded-xl" />
              </div>
            ))}
          </div>
        ) : crm.deals.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No deals yet. Ask the assistant to research an account to get
            started.
          </div>
        ) : (
          <PipelineBoard
            crm={crm}
            selectedDealId={selectedDealId}
            onSelect={setSelectedDealId}
            onMoveStage={moveDealStage}
          />
        )}
      </div>
    </div>
  );
}
