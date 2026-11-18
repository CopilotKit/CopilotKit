"use client";
import { createContext, useContext } from "react";
import { useCrm } from "@/hooks/use-crm";
import type { CrmState, Stage } from "@/lib/crm";

interface CrmContextValue {
  crm: CrmState;
  loading: boolean;
  selectedDealId: string | null;
  setSelectedDealId: (id: string | null) => void;
  moveDealStage: (dealId: string, stage: Stage) => void;
}

const CrmContext = createContext<CrmContextValue | null>(null);

export function CrmProvider({ children }: { children: React.ReactNode }) {
  const value = useCrm();
  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
}

export function useCrmContext(): CrmContextValue {
  const ctx = useContext(CrmContext);
  if (!ctx) throw new Error("useCrmContext must be used within CrmProvider");
  return ctx;
}
