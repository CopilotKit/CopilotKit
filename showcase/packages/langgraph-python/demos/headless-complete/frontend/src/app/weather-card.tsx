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
    <div className="mt-2 mb-2 max-w-xs rounded-lg border border-blue-200 bg-gradient-to-br from-blue-500 to-sky-600 p-3 text-white shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-white/80">
            {loading ? "Fetching weather" : "Weather"}
          </div>
          <div className="truncate text-sm font-semibold capitalize">
            {location || "Unknown"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold leading-none">
            {loading ? "..." : temperature != null ? `${temperature}°` : "--"}
          </div>
          {!loading && (
            <div className="mt-0.5 text-[11px] capitalize text-white/80">
              {conditions ?? ""}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
