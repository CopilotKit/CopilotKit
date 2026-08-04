"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { Lane, Shipment } from "./data/types";

/**
 * Binds live ledger data into the a2ui catalog renderers. Data never travels
 * inside the A2UI operations — the agent selects WHAT to show and the
 * renderers read the real figures from here, so no number on the canvas is
 * ever model-authored.
 */
type BriefData = { shipments: Shipment[]; lanes: Lane[] };

const BriefDataContext = createContext<BriefData>({ shipments: [], lanes: [] });

export const useBriefData = (): BriefData => useContext(BriefDataContext);

export function BriefDataProvider({
  value,
  children,
}: {
  value: BriefData;
  children: ReactNode;
}) {
  return (
    <BriefDataContext.Provider value={value}>
      {children}
    </BriefDataContext.Provider>
  );
}
