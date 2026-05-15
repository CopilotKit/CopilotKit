"use client";

import React from "react";

/**
 * Compact gray/green/red stock card rendered when the backend
 * `get_stock_price` tool runs. Wired through the manual
 * `useRenderToolCall` path via `useRenderTool({ name: "get_stock_price", ... })`
 * in `tool-renderers.tsx`.
 */
export interface StockCardProps {
  loading: boolean;
  ticker: string;
  price?: number;
  changePct?: number;
}

export function StockCard({
  loading,
  ticker,
  price,
  changePct,
}: StockCardProps) {
  const isUp = (changePct ?? 0) >= 0;
  const accent = isUp ? "text-[#189370]" : "text-[#FA5F67]";
  const arrow = isUp ? "▲" : "▼";
  return (
    <div className="mt-2 mb-2 max-w-xs rounded-xl border border-[#DBDBE5] bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#838389]">
            {loading ? "Loading" : "Stock"}
          </div>
          <div className="truncate text-sm font-semibold text-[#010507] font-mono">
            {ticker ? ticker.toUpperCase() : "--"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-base font-semibold leading-none text-[#010507] font-mono">
            {loading ? "..." : price != null ? `$${price.toFixed(2)}` : "--"}
          </div>
          {!loading && changePct != null && (
            <div
              className={`mt-0.5 text-[11px] font-medium font-mono ${accent}`}
            >
              {arrow} {Math.abs(changePct).toFixed(2)}%
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
