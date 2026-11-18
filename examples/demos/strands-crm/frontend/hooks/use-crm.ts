"use client";
import { useCallback, useEffect, useState } from "react";
import { useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";
import { applyStageOverlay, pruneOverlay } from "../lib/crm";
import type { CrmState, Stage } from "../lib/crm";

const EMPTY: CrmState = {
  deals: [],
  accounts: [],
  contacts: [],
  activities: [],
  products: [],
  salespeople: [],
  reports: [],
  quotes: [],
};

export function useCrm() {
  const { agent } = useAgent({
    agentId: "strands_agent",
    updates: [UseAgentUpdate.OnStateChanged],
  });
  const [initial, setInitial] = useState<CrmState | null>(null);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Record<string, Stage>>({});

  useEffect(() => {
    fetch("/api/crm")
      .then((r) => r.json())
      .then((s) =>
        setInitial(s && Array.isArray(s.deals) ? (s as CrmState) : EMPTY),
      )
      .catch(() => setInitial(EMPTY));
  }, []);

  const fromAgent = agent?.state as CrmState | undefined;
  const hasDeals = (s: CrmState | null | undefined): s is CrmState =>
    !!s && Array.isArray(s.deals);
  const base: CrmState = hasDeals(fromAgent)
    ? fromAgent
    : hasDeals(initial)
      ? initial
      : EMPTY;

  // Reconcile: drop overlay entries the authoritative base already reflects.
  // Keyed on a stable string (not the base object) so this never loops.
  const baseKey = base.deals.map((d) => `${d.id}:${d.stage}`).join("|");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOverlay((o) => {
      const pruned = pruneOverlay(base, o);
      return Object.keys(pruned).length === Object.keys(o).length ? o : pruned;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey]);

  const crm = applyStageOverlay(base, overlay);

  const moveDealStage = useCallback((dealId: string, stage: Stage) => {
    setOverlay((o) => ({ ...o, [dealId]: stage })); // optimistic
    fetch("/api/crm/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealId, stage }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("move failed");
        return r.json();
      })
      .then(() => fetch("/api/crm").then((r) => r.json()))
      .then((s) => {
        if (s && Array.isArray(s.deals)) setInitial(s as CrmState);
      })
      .catch(() => {
        setOverlay((o) => {
          const n = { ...o };
          delete n[dealId];
          return n;
        }); // revert
        if (typeof console !== "undefined")
          console.error("Stage move failed for", dealId);
      });
  }, []);

  return {
    crm,
    loading: !initial && !fromAgent,
    selectedDealId,
    setSelectedDealId,
    moveDealStage,
  };
}
