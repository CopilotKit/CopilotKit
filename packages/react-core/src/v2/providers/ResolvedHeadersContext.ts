import { createContext, createElement, useContext } from "react";
import type { ReactNode } from "react";

export type ResolvedHeaderRecord = Record<string, string>;

const ResolvedHeadersContext = createContext<ResolvedHeaderRecord | null>(null);

export function ResolvedHeadersProvider({
  value,
  children,
}: {
  value: ResolvedHeaderRecord;
  children: ReactNode;
}) {
  return createElement(ResolvedHeadersContext.Provider, { value }, children);
}

export function useResolvedHeaderRecord(): ResolvedHeaderRecord | null {
  return useContext(ResolvedHeadersContext);
}
