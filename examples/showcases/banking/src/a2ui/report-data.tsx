"use client";

import { createContext, useContext } from "react";
import type { ExpensePolicy, Transaction } from "@/app/api/v1/data";

export interface ReportData {
  transactions: Transaction[];
  policies: ExpensePolicy[];
}

const ReportDataContext = createContext<ReportData | null>(null);

export function ReportDataProvider({
  value,
  children,
}: {
  value: ReportData;
  children: React.ReactNode;
}) {
  return (
    <ReportDataContext.Provider value={value}>
      {children}
    </ReportDataContext.Provider>
  );
}

/** Live banking data for A2UI report renderers. Returns empty arrays if a
 *  renderer is mounted outside the provider (shouldn't happen in the canvas). */
export function useReportData(): ReportData {
  return useContext(ReportDataContext) ?? { transactions: [], policies: [] };
}
