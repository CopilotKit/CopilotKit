"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlannerAuth } from "./components/planner-auth-context";
import type {
  Decision,
  Escalation,
  InventoryRisk,
  Lane,
  MitigationKind,
  MitigationOption,
  Shipment,
} from "./data/types";

/**
 * Cross-instance revalidation bus. Every live `useLogistics()` registers a
 * refetch callback; any mutation calls `notifyDataChanged()` so all instances
 * re-pull. Without this, the agent committing a mitigation in chat would leave
 * the control-tower board showing the shipment as still delayed.
 */
const listeners = new Set<() => void>();
function notifyDataChanged() {
  for (const listener of listeners) listener();
}

const BASE = "/api/logistics/v1";

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (error) {
    console.error(`[logistics] GET ${path} failed:`, error);
    return fallback;
  }
}

export function useLogistics() {
  const { currentPlanner } = usePlannerAuth();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [inventory, setInventory] = useState<InventoryRisk[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);

  const refresh = useCallback(() => {
    void getJson<Shipment[]>("/shipments", []).then(setShipments);
    void getJson<Lane[]>("/lanes", []).then(setLanes);
    void getJson<InventoryRisk[]>("/inventory", []).then(setInventory);
    void getJson<Decision[]>("/decisions", []).then(setDecisions);
  }, []);

  useEffect(() => {
    refresh();
    listeners.add(refresh);
    return () => {
      listeners.delete(refresh);
    };
  }, [refresh]);

  const fetchOptions = useCallback(
    (shipmentId: string) =>
      getJson<MitigationOption[]>(`/shipments/${shipmentId}/options`, []),
    [],
  );

  /**
   * Commit a mitigation. Sends NO cost — the server recomputes it. Always
   * refreshes, success or failure, so the UI shows real state rather than an
   * optimistic guess, and surfaces the server's message on a 403 so the agent
   * can learn the block instead of reporting a false success.
   */
  const commitMitigation = useCallback(
    async ({
      shipmentId,
      kind,
      rationale,
    }: {
      shipmentId: string;
      kind: MitigationKind;
      rationale: string;
    }) => {
      try {
        const res = await fetch(`${BASE}/shipments/${shipmentId}/mitigate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            rationale,
            plannerId: currentPlanner.id,
          }),
        });
        const body = await res.json().catch(() => null);
        notifyDataChanged();
        if (!res.ok)
          return {
            ok: false as const,
            error: body?.message ?? "Could not commit the mitigation.",
          };
        return { ok: true as const, option: body?.option as MitigationOption };
      } catch (error) {
        console.error("[logistics] commitMitigation failed:", error);
        return { ok: false as const, error: "Network error." };
      }
    },
    [currentPlanner.id],
  );

  /** Open a draft escalation and approve it (the demo has no review step). */
  const fileEscalation = useCallback(
    async ({
      shipmentId,
      code,
      rationale,
    }: {
      shipmentId: string;
      code: string;
      rationale: string;
    }) => {
      try {
        const openRes = await fetch(`${BASE}/escalations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shipmentId, code, rationale }),
        });
        const draft = await openRes.json().catch(() => null);
        if (!openRes.ok) {
          notifyDataChanged();
          return {
            ok: false as const,
            error: draft?.message ?? "Could not open the escalation.",
          };
        }
        const approveRes = await fetch(
          `${BASE}/escalations/${draft.id}/approve`,
          { method: "POST" },
        );
        const approved = await approveRes.json().catch(() => null);
        notifyDataChanged();
        if (!approveRes.ok) {
          return {
            ok: false as const,
            error: approved?.message ?? "Could not approve the escalation.",
          };
        }
        return { ok: true as const, escalation: approved as Escalation };
      } catch (error) {
        console.error("[logistics] fileEscalation failed:", error);
        return { ok: false as const, error: "Network error." };
      }
    },
    [],
  );

  const fileDecision = useCallback(
    async (input: {
      shipmentId: string;
      kind: MitigationKind | "escalation";
      costUsd: number;
      rationale: string;
      status?: "committed" | "escalated";
    }) => {
      try {
        const res = await fetch(`${BASE}/decisions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            status: input.status ?? "committed",
            decidedBy: currentPlanner.name,
            role: currentPlanner.role,
          }),
        });
        notifyDataChanged();
        if (!res.ok)
          return { ok: false as const, error: "Could not file the decision." };
        return { ok: true as const };
      } catch (error) {
        console.error("[logistics] fileDecision failed:", error);
        return { ok: false as const, error: "Network error." };
      }
    },
    [currentPlanner.name, currentPlanner.role],
  );

  return {
    shipments,
    lanes,
    inventory,
    decisions,
    refresh,
    fetchOptions,
    commitMitigation,
    fileEscalation,
    fileDecision,
  };
}

export default useLogistics;
