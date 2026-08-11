export type Unit = "usd" | "ratio" | "pct" | "months";

/**
 * `pct` and `months` are the metrics where DOWN is good (logo churn, CAC
 * payback). They are listed once here so no component re-derives the rule.
 */
const LOWER_IS_BETTER: Unit[] = ["pct", "months"];
const MATERIAL = 0.001;

export function formatValue(
  value: number,
  unit: Unit,
  opts: { compact?: boolean } = {},
): string {
  switch (unit) {
    case "usd": {
      if (!opts.compact) {
        return `$${Math.round(value).toLocaleString("en-US")}`;
      }
      const abs = Math.abs(value);
      if (abs >= 1_000_000_000)
        return `$${(value / 1_000_000_000).toFixed(1)}B`;
      if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
      if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`;
      return `$${Math.round(value)}`;
    }
    case "ratio":
      return `${value.toFixed(1)}x`;
    case "pct":
      return `${(value * 100).toFixed(1)}%`;
    case "months":
      return `${value.toFixed(1)} mo`;
  }
}

export function formatDelta(deltaPct: number): string {
  const pct = (deltaPct * 100).toFixed(1);
  return deltaPct > 0 ? `+${pct}%` : `${pct}%`;
}

export function deltaTone(
  deltaPct: number,
  unit: Unit,
): "positive" | "negative" | "neutral" {
  if (Math.abs(deltaPct) < MATERIAL) return "neutral";
  const good = LOWER_IS_BETTER.includes(unit) ? deltaPct < 0 : deltaPct > 0;
  return good ? "positive" : "negative";
}
