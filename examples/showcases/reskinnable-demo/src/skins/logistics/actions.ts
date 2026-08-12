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
  RateBrief,
  RateBriefLane,
  Shipment,
} from "./data/types";

/**
 * Cross-instance revalidation bus. Every live `useLogistics()` registers a
 * refetch callback; any mutation calls `notifyDataChanged()` so all instances
 * re-pull. Without this, the agent committing a mitigation in chat would leave
 * the control-tower board showing the shipment as still delayed.
 */
const listeners = new Set<() => void>();
/**
 * Exported because beat 3a's PIN card writes through its OWN fetch — the digits
 * go straight from the component to the authorization route and never pass
 * through this module — so nothing here can notice that write. Without a
 * notification the Control Tower would still show the shipment as delayed after
 * the planner released it on stage, which is the one thing that beat has to
 * disprove. See `tools.tsx`'s `authorizeWithPlannerPin`.
 */
export function notifyDataChanged() {
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
  // BEAT 3d — the durable artifact. Fetched like every other collection here,
  // because it belongs to the app rather than to the thread that produced it.
  const [rateBriefs, setRateBriefs] = useState<RateBrief[]>([]);

  const refresh = useCallback(() => {
    void getJson<Shipment[]>("/shipments", []).then(setShipments);
    void getJson<Lane[]>("/lanes", []).then(setLanes);
    void getJson<InventoryRisk[]>("/inventory", []).then(setInventory);
    void getJson<Decision[]>("/decisions", []).then(setDecisions);
    void getJson<RateBrief[]>("/briefs", []).then(setRateBriefs);
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
            // decidedBy/role are derived server-side from the planner; the
            // client only forwards which planner is acting.
            plannerId: currentPlanner.id,
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
    [currentPlanner.id],
  );

  /**
   * BEAT 3d — file the rate brief read out of an attached carrier rate sheet.
   *
   * Sends NO `filedBy`/`role`: the server derives both from the planner, exactly
   * as `fileDecision` does, so the artifact's attribution cannot be forged by
   * whatever the model happened to type. Surfaces the route's own message on a
   * refusal — `POST /briefs` names the offending field, and the agent can only
   * act on that if it can see it.
   */
  const fileRateBrief = useCallback(
    async (input: {
      carrier: string;
      effective: string;
      summary: string;
      laneRates: RateBriefLane[];
      impacts: string[];
    }) => {
      try {
        const res = await fetch(`${BASE}/briefs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, plannerId: currentPlanner.id }),
        });
        const body = await res.json().catch(() => null);
        notifyDataChanged();
        if (!res.ok)
          return {
            ok: false as const,
            error: body?.message ?? "Could not file the rate brief.",
          };
        return {
          ok: true as const,
          brief: body as RateBrief,
          // The two ways the filed record can differ from what was sent, both
          // surfaced so the agent narrates the correction rather than a
          // comparison the record does not contain. See POST /briefs, which
          // SETTLES every prior rate against the carrier's own lanes:
          // `noPriorRateOnFile` is what it dropped (no such lane, so no rate on
          // file), `ambiguousLanes` is where it could not tell which lane the
          // sheet meant and left the model's reading standing.
          noPriorRateOnFile: Array.isArray(body?.noPriorRateOnFile)
            ? (body.noPriorRateOnFile as string[])
            : [],
          ambiguousLanes: Array.isArray(body?.ambiguousLanes)
            ? (body.ambiguousLanes as string[])
            : [],
        };
      } catch (error) {
        console.error("[logistics] fileRateBrief failed:", error);
        return { ok: false as const, error: "Network error." };
      }
    },
    [currentPlanner.id],
  );

  return {
    shipments,
    lanes,
    inventory,
    decisions,
    rateBriefs,
    refresh,
    fetchOptions,
    commitMitigation,
    fileEscalation,
    fileDecision,
    fileRateBrief,
  };
}

export default useLogistics;
