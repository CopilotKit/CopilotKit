"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type {
  BreakdownRow,
  KpiResult,
  SeriesResult,
  WaterfallStep,
} from "./data/derive";
import { useKpis, useSeries } from "./data/hooks";
import { DEFAULT_LENS } from "./data/lens";
import type { Lens, MetricId } from "./data/types";

interface BoardData {
  kpis: KpiResult[];
  series: SeriesResult | null;
  breakdownBySegment: BreakdownRow[];
  breakdownByRegion: BreakdownRow[];
  waterfall: WaterfallStep[];
}

const BoardDataContext = createContext<BoardData | null>(null);

/**
 * Binds live figures for the a2ui canvas renderers. The agent's ops never carry
 * a number — they choose a layout, and this supplies the truth, so the canvas
 * cannot show a figure the app disagrees with.
 *
 * `lens` and `metrics` MUST come from the board's own ops (the canvas reads them
 * with `extractBoardBinding`). The defaults here are the no-board fallback only:
 * leaving them in place for a real board is what made the canvas show DEFAULT_LENS
 * figures under the agent's chosen heading.
 */
export function BoardDataProvider({
  lens = DEFAULT_LENS,
  metrics,
  children,
}: {
  lens?: Lens;
  metrics?: MetricId[];
  children: ReactNode;
}) {
  const { kpis } = useKpis(lens, metrics);
  const bySegment = useSeries(lens, "arr", "segment");
  const byRegion = useSeries(lens, "arr", "region");
  return (
    <BoardDataContext.Provider
      value={{
        kpis,
        series: bySegment.series,
        breakdownBySegment: bySegment.breakdown,
        breakdownByRegion: byRegion.breakdown,
        waterfall: bySegment.waterfall,
      }}
    >
      {children}
    </BoardDataContext.Provider>
  );
}

/** Live board figures for a2ui canvas renderers. Returns an empty shape if a
 *  renderer is mounted outside the provider (may happen transiently during
 *  surface processing) — throwing there would blank the canvas. */
export function useBoardData(): BoardData {
  return (
    useContext(BoardDataContext) ?? {
      kpis: [],
      series: null,
      breakdownBySegment: [],
      breakdownByRegion: [],
      waterfall: [],
    }
  );
}
