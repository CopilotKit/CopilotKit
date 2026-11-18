"use client";

import { createContext, useContext } from "react";
import type { DashboardId, LedgerSnapshot } from "@/skins/exec/data/types";

export interface BlockData {
  snapshot: LedgerSnapshot;
  addBlock: (dashboardId: DashboardId, blockId: string) => Promise<void>;
  isPinned: (blockId: string) => boolean;
}

const BlockDataContext = createContext<BlockData | null>(null);

export function BlockDataProvider({
  value,
  children,
}: {
  value: BlockData;
  children: React.ReactNode;
}) {
  return (
    <BlockDataContext.Provider value={value}>
      {children}
    </BlockDataContext.Provider>
  );
}

const EMPTY_SNAPSHOT: LedgerSnapshot = {
  metricDefs: [],
  points: [],
  initiatives: [],
  narratives: [],
  dashboards: {
    ceo: { id: "ceo", title: "CEO Dashboard", blocks: [] },
    cfo: { id: "cfo", title: "CFO Dashboard", blocks: [] },
  },
  packs: [],
  exceptions: [],
};

/**
 * Live exec data for A2UI block renderers. Falls back to a safe read-only
 * snapshot if a renderer is mounted outside the provider (shouldn't happen in
 * the canvas): `snapshot` is the empty ledger and `isPinned` reports `false`,
 * neither of which can lie because there is nothing behind them to be wrong
 * about.
 *
 * `addBlock` is the exception — it is a WRITE, and resolving silently would
 * tell `AddToDashboard` the pin worked when nothing happened, flipping its
 * button to a false "Pinned ✓" with no provider underneath to ever unpin it.
 * It rejects instead, so that control's existing error path renders the
 * failure instead of a lie.
 */
export function useBlockData(): BlockData {
  return (
    useContext(BlockDataContext) ?? {
      snapshot: EMPTY_SNAPSHOT,
      addBlock: () =>
        Promise.reject(
          new Error("BlockDataProvider is not mounted — pin unavailable"),
        ),
      isPinned: () => false,
    }
  );
}
