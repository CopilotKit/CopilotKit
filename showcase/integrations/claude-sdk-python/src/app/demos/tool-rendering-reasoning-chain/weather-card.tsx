"use client";

import React from "react";

export interface WeatherCardProps {
  loading: boolean;
  location: string;
  temperature?: number;
  humidity?: number;
  windSpeed?: number;
  conditions?: string;
}

export function WeatherCard({
  loading,
  location,
  temperature,
  humidity,
  windSpeed,
  conditions,
}: WeatherCardProps) {
  return (
    <div
      data-testid="weather-card"
      className="rounded-2xl mt-4 mb-4 max-w-md w-full bg-[#EDEDF5] border border-[#DBDBE5] text-[#010507] shadow-sm"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-[#57575B] mb-1">
              Current weather
            </div>
            <h3
              data-testid="weather-city"
              className="text-xl font-semibold capitalize text-[#010507]"
            >
              {location || "Weather"}
            </h3>
            <p className="text-[#57575B] text-sm mt-0.5">
              {loading ? "Fetching weather..." : conditions || "—"}
            </p>
          </div>
          <div className="text-4xl leading-none" aria-hidden>
            {loading ? "..." : ""}
          </div>
        </div>

        {!loading && (
          <>
            <div className="mt-5 text-4xl font-semibold text-[#010507] tracking-tight">
              {temperature ?? "--"}&deg;
              <span className="ml-1 text-lg font-normal text-[#57575B]">F</span>
            </div>
            <div className="mt-5 pt-4 border-t border-[#DBDBE5] grid grid-cols-2 gap-3 text-sm">
              <div data-testid="weather-humidity">
                <p className="text-[10px] uppercase tracking-[0.14em] text-[#57575B]">
                  Humidity
                </p>
                <p className="mt-1 font-medium text-[#010507]">
                  {humidity ?? "--"}%
                </p>
              </div>
              <div data-testid="weather-wind">
                <p className="text-[10px] uppercase tracking-[0.14em] text-[#57575B]">
                  Wind
                </p>
                <p className="mt-1 font-medium text-[#010507]">
                  {windSpeed ?? "--"} mph
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
