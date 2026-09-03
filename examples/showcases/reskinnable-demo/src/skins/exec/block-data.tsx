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

/** Live exec data for A2UI block renderers. Returns a safe empty snapshot if a
 *  renderer is mounted outside the provider (shouldn't happen in the canvas). */
export function useBlockData(): BlockData {
  return (
    useContext(BlockDataContext) ?? {
      snapshot: EMPTY_SNAPSHOT,
      addBlock: async () => {},
      isPinned: () => false,
    }
  );
}
