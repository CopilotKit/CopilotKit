"use client";

import React from "react";

// Per-tool renderer for the `get_stock_price` backend tool. Registered
// in page.tsx via `useRenderTool({ name: "get_stock_price", ... })`.
// Carries a stable `data-testid="stock-card"` and inner price/change
// testids so the cell's e2e tests can pin to deterministic fixture
// values.

export interface StockCardProps {
  loading: boolean;
  ticker: string;
  priceUsd?: number;
  changePct?: number;
}

export function StockCard({
  loading,
  ticker,
  priceUsd,
  changePct,
}: StockCardProps) {
  const upper = (ticker || "").toUpperCase();
  const positive = (changePct ?? 0) >= 0;
  const changeStr =
    changePct === undefined
      ? "--"
      : `${positive ? "+" : ""}${changePct.toFixed(2)}%`;

  return (
    <div
      data-testid="stock-card"
      className="my-3 rounded-2xl border border-[#DBDBE5] bg-white p-5 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#BEC2FF1A] font-semibold text-[#010507]"
            aria-hidden
          >
            $
          </span>
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-[#57575B]">
              Stock
            </div>
            <div
              data-testid="stock-ticker"
              className="font-mono text-base font-semibold text-[#010507]"
            >
              {upper || "—"}
            </div>
          </div>
        </div>
        {loading ? (
          <span className="text-[10px] uppercase tracking-[0.14em] text-[#57575B]">
            fetching…
          </span>
        ) : null}
      </div>

      {!loading ? (
        <div className="mt-4 flex items-end justify-between border-t border-[#DBDBE5] pt-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-[#57575B]">
              Price
            </div>
            <div
              data-testid="stock-price"
              className="mt-1 text-2xl font-semibold text-[#010507] tracking-tight"
            >
              {priceUsd !== undefined ? `$${priceUsd.toFixed(2)}` : "—"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[#57575B]">
              Change
            </div>
            <div
              data-testid="stock-change"
              className={`mt-1 font-mono text-sm font-medium ${
                positive ? "text-[#189370]" : "text-[#D14343]"
              }`}
            >
              {changeStr}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
