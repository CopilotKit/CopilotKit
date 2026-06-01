"use client";

import React from "react";

/**
 * Compact blue weather card rendered when the backend `get_weather`
 * tool runs. Wired to the manual `useRenderToolCall` path via the
 * `useRenderTool({ name: "get_weather", ... })` registration in
 * `tool-renderers.tsx`.
 */
export interface WeatherCardProps {
  loading: boolean;
  location: string;
  temperature?: number;
  conditions?: string;
}

export function WeatherCard({
  loading,
  location,
  temperature,
  conditions,
}: WeatherCardProps) {
  return (
    <div className="mt-2 mb-2 max-w-xs rounded-xl border border-[#DBDBE5] bg-[#EDEDF5] p-3 text-[#010507] shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#57575B]">
            {loading ? "Fetching weather" : "Weather"}
          </div>
          <div className="truncate text-sm font-semibold capitalize text-[#010507]">
            {location || "Unknown"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold leading-none text-[#010507] tracking-tight">
            {loading ? "..." : temperature != null ? `${temperature}°` : "--"}
          </div>
          {!loading && (
            <div className="mt-0.5 text-[11px] capitalize text-[#57575B]">
              {conditions ?? ""}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
