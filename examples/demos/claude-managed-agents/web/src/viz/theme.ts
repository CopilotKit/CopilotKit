/**
 * Chart theme: validated categorical slots on the light surface
 * (CVD-checked; the aqua and yellow slots require direct labels for
 * contrast relief, which every chart here provides).
 */
export const SERIES = {
  blue: "#2a78d6",
  aqua: "#1baf7a",
} as const;

export const INK = {
  primary: "#010507",
  secondary: "#57575b",
  grid: "#e2e2ea",
  surface: "#ffffff",
} as const;

const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const fmtUsd = (n: number): string => usd0.format(Math.round(n));

/** Compact dollar label for axes: $12k, $1.2M. */
export const fmtUsdCompact = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000)
    return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return usd0.format(n);
};
