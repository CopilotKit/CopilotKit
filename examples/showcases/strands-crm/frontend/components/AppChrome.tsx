"use client";
import { CrmProvider, useCrmContext } from "./crm-context";
import { useCopilotFeatures } from "@/hooks/use-copilot-features";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";
import { DealDrawer } from "./DealDrawer";
import { AssistantPanel } from "./AssistantPanel";

function Shell({ children }: { children: React.ReactNode }) {
  const { crm, selectedDealId, setSelectedDealId, moveDealStage } =
    useCrmContext();
  useCopilotFeatures({ setSelectedDealId });
  return (
    <div className="flex h-screen bg-background text-foreground">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        {/* relative + overflow-hidden so the deal slide-over is contained here, never overlapping the assistant */}
        <main className="relative min-h-0 flex-1 overflow-hidden">
          {children}
          <DealDrawer
            crm={crm}
            dealId={selectedDealId}
            onOpenChange={(open) => {
              if (!open) setSelectedDealId(null);
            }}
            onMoveStage={moveDealStage}
          />
        </main>
      </div>
      <AssistantPanel />
    </div>
  );
}

export function AppChrome({ children }: { children: React.ReactNode }) {
  return (
    <CrmProvider>
      <Shell>{children}</Shell>
    </CrmProvider>
  );
}
