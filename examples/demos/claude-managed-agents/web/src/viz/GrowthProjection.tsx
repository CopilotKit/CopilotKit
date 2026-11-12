/**
 * Interactive compound growth: projected value vs total contributed, with
 * sliders for monthly contribution and assumed return.
 */
import React, { useMemo, useState } from "react";
import { growthSchedule } from "./finance";
import { LineChart } from "./LineChart";
import { SERIES, fmtUsd, fmtUsdCompact } from "./theme";

export interface GrowthArgs {
  title: string;
  initialAmount: number;
  monthlyContribution: number;
  annualReturnPercent: number;
  years: number;
}

export const GrowthProjection: React.FC<GrowthArgs> = ({
  title,
  initialAmount,
  monthlyContribution,
  annualReturnPercent,
  years,
}) => {
  const returnMax = Math.max(12, annualReturnPercent);
  const [monthly, setMonthly] = useState(monthlyContribution);
  const [returnPct, setReturnPct] = useState(() =>
    Math.min(returnMax, Math.max(0, annualReturnPercent)),
  );

  const points = useMemo(
    () => growthSchedule(initialAmount, monthly, returnPct, years),
    [initialAmount, monthly, returnPct, years],
  );
  const last = points[points.length - 1]!;
  const growth = last.value - last.contributed;

  return (
    <div className="viz-card">
      <h4>{title}</h4>
      <p className="viz-sub">
        {fmtUsd(initialAmount)} start, {fmtUsd(monthly)}/mo at {returnPct}% for{" "}
        {Math.round(years)} years
      </p>
      <div className="viz-stats">
        <div>
          <span className="viz-stat-label">Projected value</span>
          <span className="viz-stat-value" style={{ color: SERIES.blue }}>
            {fmtUsd(last.value)}
          </span>
        </div>
        <div>
          <span className="viz-stat-label">You put in</span>
          <span className="viz-stat-value" style={{ color: SERIES.aqua }}>
            {fmtUsd(last.contributed)}
          </span>
        </div>
        <div>
          <span className="viz-stat-label">Growth</span>
          <span className="viz-stat-value">{fmtUsd(growth)}</span>
          <span className="viz-stat-note">
            {last.contributed > 0
              ? `${Math.round((growth / last.contributed) * 100)}% on top`
              : ""}
          </span>
        </div>
      </div>
      <LineChart
        series={[
          {
            label: "Value",
            color: SERIES.blue,
            values: points.map((p) => p.value),
            area: true,
          },
          {
            label: "Contributed",
            color: SERIES.aqua,
            values: points.map((p) => p.contributed),
          },
        ]}
        fmtX={(y) => `Yr ${y}`}
        fmtY={fmtUsdCompact}
      />
      <label className="viz-slider">
        Monthly contribution: <b>{fmtUsd(monthly)}</b>
        <input
          type="range"
          min={0}
          max={Math.max(monthlyContribution * 3, 500)}
          step={25}
          value={monthly}
          onChange={(e) => setMonthly(Number(e.target.value))}
        />
      </label>
      <label className="viz-slider">
        Annual return: <b>{returnPct}%</b>
        <input
          type="range"
          min={0}
          max={returnMax}
          step={0.5}
          value={returnPct}
          onChange={(e) => setReturnPct(Number(e.target.value))}
        />
      </label>
    </div>
  );
};
