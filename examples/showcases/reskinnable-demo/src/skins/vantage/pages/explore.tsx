"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useAgentContext } from "@copilotkit/react-core/v2";
import {
  COMPARE_OPTIONS,
  CURRENCY_OPTIONS,
  GRAIN_OPTIONS,
  PERIOD_OPTIONS,
  REGION_OPTIONS,
  SEGMENT_OPTIONS,
  isLensAxisSet,
  lensToParams,
  parseLens,
} from "../data/lens";
import type { Lens } from "../data/types";
import { useSeries } from "../data/hooks";
import { useVantageHref } from "../href";
import { formatValue } from "../data/format";
import { TrendChart } from "../components/charts/trend-chart";
import { BreakdownChart } from "../components/charts/breakdown-chart";
import { WaterfallChart } from "../components/charts/waterfall-chart";
import { cn } from "@/lib/utils";

/**
 * One lever. `active` means this axis has been moved off its default — which is
 * exactly when the agent has set it, so it gets the brand tint. Mirrors
 * banking's activeSelect pattern (`border-brand/50 bg-brand-soft font-semibold`).
 */
function Lever<T extends string>({
  label,
  value,
  options,
  active,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  active: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-wide",
          active ? "text-brand" : "text-ink-muted",
        )}
      >
        {label}
      </span>
      <select
        aria-label={label}
        data-active={active ? "true" : "false"}
        data-testid={`lever-${label.toLowerCase()}`}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={cn(
          "rounded-[var(--radius)] border px-2 py-1.5 text-xs transition-colors",
          active
            ? "border-brand/50 bg-brand-soft font-semibold text-brand"
            : "border-hairline bg-surface text-ink",
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// The Explore page's own canonical default for the breakdown dimension.
// Read (searchParams.get fallback) and write (the setAxis omit-sentinel below)
// MUST agree on this value — mirrors the invariant `lensToParams` maintains
// for the six lens axes: omit exactly what equals the default, so the URL and
// the UI can never disagree. Chosen independently of `useSeries`' own
// "segment" default in `data/hooks.ts`, since this page always passes an
// explicit third argument and never relies on that fallback.
const DEFAULT_DIMENSION = "region" as const;

export function ExplorePage() {
  const router = useRouter();
  const vantageHref = useVantageHref();
  const searchParams = useSearchParams();
  const lens = parseLens(new URLSearchParams(searchParams.toString()));
  const dimension =
    (searchParams.get("dimension") as
      | "segment"
      | "region"
      | "channel"
      | null) ?? DEFAULT_DIMENSION;
  const { series, breakdown, waterfall } = useSeries(lens, "arr", dimension);

  const setAxis = <K extends keyof Lens>(axis: K, value: Lens[K]) => {
    const params = lensToParams({ ...lens, [axis]: value });
    if (dimension !== DEFAULT_DIMENSION) params.set("dimension", dimension);
    const qs = params.toString();
    // Same page, new levers — through the builder, so a locked deploy keeps
    // pulling a lever at `/explore?…` instead of jumping back to `/vantage/…`.
    const path = vantageHref("explore");
    router.push(qs ? `${path}?${qs}` : path);
  };

  const activeLevers = (Object.keys(lens) as (keyof Lens)[])
    .filter((axis) => isLensAxisSet(lens, axis))
    .map((axis) => `${axis}=${lens[axis]}`);

  // ON-SCREEN READABLE: the ACTIVE LEVERS plus the figures they produced. This
  // is what makes the second "what am I looking at?" answer differ from the
  // Boardroom's.
  useAgentContext({
    description:
      "What is visibly on the Explore page right now: the active lever values, " +
      "the resulting series, its breakdown and the plan-variance waterfall. " +
      "Cite these figures and name the levers that are set.",
    value: JSON.stringify({
      page: "Explore",
      activeLevers: activeLevers.length
        ? activeLevers
        : ["none — all defaults"],
      lens,
      breakdownDimension: dimension,
      total: series
        ? formatValue(series.total, series.unit, { compact: true })
        : null,
      comparison: series?.comparison
        ? {
            basis: series.comparison.basis,
            vs: series.comparison.baselineLabel,
            change: `${(series.comparison.deltaPct * 100).toFixed(1)}%`,
          }
        : null,
      visiblePoints: series?.points.map((p) => ({
        period: p.label,
        value: formatValue(p.value, series.unit, { compact: true }),
      })),
      breakdownRows: breakdown.map((r) => ({
        name: r.label,
        value: formatValue(r.value, "usd", { compact: true }),
        share: `${(r.share * 100).toFixed(0)}%`,
      })),
      varianceByRegion: waterfall
        .filter((s) => s.kind === "delta")
        .map((s) => ({
          region: s.label,
          vsPlan: formatValue(s.value, "usd", { compact: true }),
        })),
    }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Explore
        </h1>
        <p className="text-sm text-ink-muted">
          Move the levers. Every figure recomputes from the ledger.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2.5 rounded-[var(--radius)] border border-hairline bg-surface p-3 sm:grid-cols-3 lg:grid-cols-6">
        <Lever
          label="Period"
          value={lens.period}
          options={PERIOD_OPTIONS}
          active={isLensAxisSet(lens, "period")}
          onChange={(v) => setAxis("period", v)}
        />
        <Lever
          label="Compare"
          value={lens.compare}
          options={COMPARE_OPTIONS}
          active={isLensAxisSet(lens, "compare")}
          onChange={(v) => setAxis("compare", v)}
        />
        <Lever
          label="Segment"
          value={lens.segment}
          options={SEGMENT_OPTIONS}
          active={isLensAxisSet(lens, "segment")}
          onChange={(v) => setAxis("segment", v)}
        />
        <Lever
          label="Region"
          value={lens.region}
          options={REGION_OPTIONS}
          active={isLensAxisSet(lens, "region")}
          onChange={(v) => setAxis("region", v)}
        />
        <Lever
          label="Grain"
          value={lens.grain}
          options={GRAIN_OPTIONS}
          active={isLensAxisSet(lens, "grain")}
          onChange={(v) => setAxis("grain", v)}
        />
        <Lever
          label="Currency"
          value={lens.currency}
          options={CURRENCY_OPTIONS}
          active={isLensAxisSet(lens, "currency")}
          onChange={(v) => setAxis("currency", v)}
        />
      </div>

      {series && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[var(--radius)] border border-hairline bg-surface p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              {series.label}
            </div>
            <div className="nw-figure mt-1 text-2xl font-semibold text-ink">
              {formatValue(series.total, series.unit, { compact: true })}
            </div>
          </div>
          {series.comparison && (
            <div className="rounded-[var(--radius)] border border-hairline bg-surface p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                vs {series.comparison.baselineLabel}
              </div>
              <div
                className={cn(
                  "nw-figure mt-1 text-2xl font-semibold",
                  series.comparison.deltaPct < 0
                    ? "text-negative"
                    : "text-positive",
                )}
              >
                {(series.comparison.deltaPct * 100).toFixed(1)}%
              </div>
            </div>
          )}
        </div>
      )}

      <section className="space-y-3 rounded-[var(--radius)] border border-hairline bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink">
          {series?.label} over time
        </h2>
        {series && <TrendChart series={series} />}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-[var(--radius)] border border-hairline bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">Where it came from</h2>
          <BreakdownChart rows={breakdown} unit="usd" />
        </section>
        <section className="space-y-3 rounded-[var(--radius)] border border-hairline bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">
            Plan variance by region
          </h2>
          <WaterfallChart steps={waterfall} unit="usd" />
        </section>
      </div>
    </div>
  );
}

export default ExplorePage;
