"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { Planner } from "@/skins/logistics/data/types";

interface PlannerAuthValue {
  currentPlanner: Planner;
  plannerId: string;
  setPlannerId: (id: string) => void;
  planners: Planner[];
  ready: boolean;
}

const PlannerAuthContext = createContext<PlannerAuthValue | null>(null);

export function usePlannerAuth(): PlannerAuthValue {
  const ctx = useContext(PlannerAuthContext);
  if (!ctx)
    throw new Error("usePlannerAuth must be used inside <PlannerAuthProvider>");
  return ctx;
}

/**
 * Establishes the acting planner. Mounted by the skin's RuntimeProviders ABOVE
 * CopilotKitProvider, so `useLogisticsRuntimeProperties` can read it and the
 * provider owns the identity from its first commit. Renders null until the
 * roster resolves so no run is ever scoped to an unknown planner.
 */
export function PlannerAuthProvider({ children }: { children: ReactNode }) {
  const [planners, setPlanners] = useState<Planner[]>([]);
  const [plannerId, setPlannerId] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/logistics/v1/planners")
      .then((r) => r.json())
      .then((rows: Planner[]) => {
        if (cancelled || !rows.length) return;
        setPlanners(rows);
        setPlannerId((current) => current || rows[0].id);
      })
      .catch((err) =>
        console.error("[logistics-auth] roster fetch failed:", err),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<PlannerAuthValue | null>(() => {
    const currentPlanner = planners.find((p) => p.id === plannerId);
    if (!currentPlanner) return null;
    return { currentPlanner, plannerId, setPlannerId, planners, ready: true };
  }, [planners, plannerId]);

  if (!value) return null;
  return (
    <PlannerAuthContext.Provider value={value}>
      {children}
    </PlannerAuthContext.Provider>
  );
}
