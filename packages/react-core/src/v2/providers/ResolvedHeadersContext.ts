import { createContext, createElement, useContext } from "react";
import type { ReactNode } from "react";
import type { HeaderReadiness } from "./header-readiness";

export type ResolvedHeaderRecord = Record<string, string>;

type ResolvedHeadersValue = {
  headers: ResolvedHeaderRecord;
  barrier: HeaderReadiness;
};

const ResolvedHeadersContext = createContext<ResolvedHeadersValue | null>(null);

export function ResolvedHeadersProvider({
  value,
  barrier,
  children,
}: {
  value: ResolvedHeaderRecord;
  barrier: HeaderReadiness;
  children: ReactNode;
}) {
  return createElement(
    ResolvedHeadersContext.Provider,
    { value: { headers: value, barrier } },
    children,
  );
}

export function useResolvedHeaderRecord(): ResolvedHeaderRecord | null {
  return useContext(ResolvedHeadersContext)?.headers ?? null;
}

export function useHeaderReadiness(): HeaderReadiness | null {
  return useContext(ResolvedHeadersContext)?.barrier ?? null;
}
