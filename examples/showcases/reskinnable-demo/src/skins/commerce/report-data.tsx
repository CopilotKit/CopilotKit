"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { MarginFloor, Order, Product, Promotion } from "./data/types";

/**
 * Binds Bellwether's live ledger into the a2ui catalog renderers.
 *
 * This context is the reason the agent cannot fabricate a figure on the brief:
 * data NEVER travels inside the A2UI operations. The agent selects WHAT to show
 * and the renderers (StatCard/CategoryBreakdown/TradingList) read the real
 * products / floors / orders / promotions from here — the same snapshot the
 * pages render — so every number on the canvas is client-computed, not
 * model-authored.
 */
export interface ReportData {
  products: Product[];
  floors: MarginFloor[];
  orders: Order[];
  promotions: Promotion[];
}

const ReportDataContext = createContext<ReportData | null>(null);

export function ReportDataProvider({
  value,
  children,
}: {
  value: ReportData;
  children: ReactNode;
}) {
  return (
    <ReportDataContext.Provider value={value}>
      {children}
    </ReportDataContext.Provider>
  );
}

/**
 * Live trading data for the a2ui brief renderers. Returns empty arrays if a
 * renderer somehow mounts outside the provider (shouldn't happen on the canvas)
 * so a renderer degrades to its own empty state rather than throwing.
 */
export function useReportData(): ReportData {
  return (
    useContext(ReportDataContext) ?? {
      products: [],
      floors: [],
      orders: [],
      promotions: [],
    }
  );
}
