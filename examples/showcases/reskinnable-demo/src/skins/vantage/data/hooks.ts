"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  BreakdownRow,
  KpiResult,
  SeriesResult,
  WaterfallStep,
} from "./derive";
import { lensToParams } from "./lens";
import type {
  Board,
  Dimension,
  Lens,
  MetricDefinition,
  MetricId,
  Source,
} from "./types";

/**
 * Cross-instance revalidation bus. A tool that files a board or connects a
 * source calls revalidateVantage(), and every mounted list hook refetches — so
 * the page BEHIND the chat visibly changes without a reload. That visible change
 * is the whole affordance for beats 3a and 3d; without it the mutation is
 * invisible until navigation.
 */
const listeners = new Set<() => void>();
export function revalidateVantage(): void {
  for (const listener of listeners) listener();
}

function useJson<T>(
  url: string | null,
  initial: T,
  live = false,
): {
  data: T;
  loading: boolean;
  refresh: () => void;
} {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(url !== null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) setLoading(true);
        return fetch(url);
      })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body) setData(body as T);
      })
      .catch((err) => console.error(`[vantage] ${url} failed`, err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url, tick]);

  useEffect(() => {
    if (!live) return;
    listeners.add(refresh);
    return () => {
      listeners.delete(refresh);
    };
  }, [live, refresh]);

  return { data, loading, refresh };
}

const BASE = "/api/vantage/v1";
const q = (lens: Lens, extra: Record<string, string> = {}) => {
  const params = lensToParams(lens);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
};

/**
 * `metrics` selects which KPIs to compute; omit it for the default four. The
 * board canvas passes the metrics its StatCards actually ask for, so a tile for
 * a non-default metric (nrr, magic_number) has a figure to render.
 */
export function useKpis(lens: Lens, metrics?: MetricId[]) {
  const selection: Record<string, string> = metrics?.length
    ? { metrics: metrics.join(",") }
    : {};
  const { data, loading } = useJson<{ kpis: KpiResult[] }>(
    `${BASE}/kpis${q(lens, selection)}`,
    { kpis: [] },
  );
  return { kpis: data.kpis, loading };
}

export function useSeries(
  lens: Lens,
  metric: MetricId,
  dimension: Dimension = "segment",
) {
  const { data, loading } = useJson<{
    series: SeriesResult | null;
    breakdown: BreakdownRow[];
    waterfall: WaterfallStep[];
  }>(`${BASE}/series${q(lens, { metric, dimension })}`, {
    series: null,
    breakdown: [],
    waterfall: [],
  });
  return { ...data, loading };
}

export function useBoards() {
  const { data, loading, refresh } = useJson<{ boards: Board[] }>(
    `${BASE}/boards`,
    { boards: [] },
    true,
  );
  return { boards: data.boards, loading, refresh };
}

export function useBoard(idOrSlug: string) {
  const { data, loading } = useJson<{ board: Board | null }>(
    `${BASE}/boards/${encodeURIComponent(idOrSlug)}`,
    { board: null },
    true,
  );
  return { board: data.board, loading };
}

export function useMetricCatalog() {
  const { data, loading } = useJson<{ metrics: MetricDefinition[] }>(
    `${BASE}/metrics`,
    { metrics: [] },
  );
  return { metrics: data.metrics, loading };
}

export function useSources() {
  const { data, loading, refresh } = useJson<{ sources: Source[] }>(
    `${BASE}/sources`,
    { sources: [] },
    true,
  );
  return { sources: data.sources, loading, refresh };
}
