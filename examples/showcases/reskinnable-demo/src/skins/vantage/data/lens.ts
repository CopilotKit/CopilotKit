import { z } from "zod";

import type {
  Compare,
  Currency,
  Grain,
  Lens,
  PeriodId,
  Region,
  Segment,
} from "./types";

/**
 * The single codec between a URL and a `Lens`. The Explore page, the
 * `exploreMetric` HITL tool and the `/series` route all use this one — three
 * parsers would drift, and the demo's "the agent set these controls" beat
 * depends on the page reading back exactly what the tool wrote.
 */

export const PERIOD_OPTIONS: { value: PeriodId; label: string }[] = [
  { value: "q3-2026", label: "Q3 2026" },
  { value: "q2-2026", label: "Q2 2026" },
  { value: "q1-2026", label: "Q1 2026" },
  { value: "h1-2026", label: "H1 2026" },
  { value: "ttm", label: "Trailing 12 months" },
];
export const COMPARE_OPTIONS: { value: Compare; label: string }[] = [
  { value: "qoq", label: "vs Prior period" },
  { value: "yoy", label: "vs Year ago" },
  { value: "vs-plan", label: "vs Plan" },
];
export const SEGMENT_OPTIONS: { value: Segment | "all"; label: string }[] = [
  { value: "all", label: "All segments" },
  { value: "enterprise", label: "Enterprise" },
  { value: "mid-market", label: "Mid-market" },
  { value: "smb", label: "SMB" },
];
export const REGION_OPTIONS: { value: Region | "all"; label: string }[] = [
  { value: "all", label: "All regions" },
  { value: "namer", label: "NAMER" },
  { value: "emea", label: "EMEA" },
  { value: "apac", label: "APAC" },
];
export const GRAIN_OPTIONS: { value: Grain; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
];
export const CURRENCY_OPTIONS: { value: Currency; label: string }[] = [
  { value: "reported", label: "As reported" },
  { value: "constant", label: "Constant currency" },
];

export const DEFAULT_LENS: Lens = {
  period: "q3-2026",
  compare: "qoq",
  segment: "all",
  region: "all",
  grain: "monthly",
  currency: "reported",
};

type Bag = URLSearchParams | Record<string, string | undefined>;
const read = (bag: Bag, key: string): string | undefined =>
  bag instanceof URLSearchParams ? (bag.get(key) ?? undefined) : bag[key];

const pick = <T extends string>(
  raw: string | undefined,
  options: { value: T }[],
  fallback: T,
): T => (options.some((o) => o.value === raw) ? (raw as T) : fallback);

export function parseLens(bag: Bag): Lens {
  return {
    period: pick(read(bag, "period"), PERIOD_OPTIONS, DEFAULT_LENS.period),
    compare: pick(read(bag, "compare"), COMPARE_OPTIONS, DEFAULT_LENS.compare),
    segment: pick(read(bag, "segment"), SEGMENT_OPTIONS, DEFAULT_LENS.segment),
    region: pick(read(bag, "region"), REGION_OPTIONS, DEFAULT_LENS.region),
    grain: pick(read(bag, "grain"), GRAIN_OPTIONS, DEFAULT_LENS.grain),
    currency: pick(
      read(bag, "currency"),
      CURRENCY_OPTIONS,
      DEFAULT_LENS.currency,
    ),
  };
}

export function lensToParams(lens: Lens): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of Object.keys(DEFAULT_LENS) as (keyof Lens)[]) {
    if (lens[key] !== DEFAULT_LENS[key]) params.set(key, String(lens[key]));
  }
  return params;
}

/** True when this axis has been moved off its default — drives the highlight. */
export function isLensAxisSet(lens: Lens, axis: keyof Lens): boolean {
  return lens[axis] !== DEFAULT_LENS[axis];
}

const labelOf = <T extends string>(
  options: { value: T; label: string }[],
  value: T,
) => options.find((o) => o.value === value)?.label ?? value;

export function lensSummary(lens: Lens): { label: string; value: string }[] {
  return [
    { label: "Period", value: labelOf(PERIOD_OPTIONS, lens.period) },
    { label: "Compare", value: labelOf(COMPARE_OPTIONS, lens.compare) },
    { label: "Segment", value: labelOf(SEGMENT_OPTIONS, lens.segment) },
    { label: "Region", value: labelOf(REGION_OPTIONS, lens.region) },
    { label: "Grain", value: labelOf(GRAIN_OPTIONS, lens.grain) },
    { label: "Currency", value: labelOf(CURRENCY_OPTIONS, lens.currency) },
  ];
}

/**
 * The lens as tool parameters. Shared by every gen-UI tool and by the server's
 * render_board tool, so the agent learns one vocabulary. Every field is optional
 * — `parseLens` fills the defaults, and it accepts a plain object, so a tool
 * handler passes its args straight through: `parseLens(args)`.
 */
export const lensFields = {
  period: z
    .enum(["q3-2026", "q2-2026", "q1-2026", "h1-2026", "ttm"])
    .optional()
    .describe("Reporting period. Defaults to the current quarter, Q3 2026."),
  compare: z
    .enum(["qoq", "yoy", "vs-plan"])
    .optional()
    .describe(
      "Comparison basis: qoq = versus the prior period, yoy = versus a year " +
        "ago, vs-plan = versus the financial plan.",
    ),
  segment: z
    .enum(["all", "enterprise", "mid-market", "smb"])
    .optional()
    .describe("Customer segment filter."),
  region: z
    .enum(["all", "namer", "emea", "apac"])
    .optional()
    .describe("Region filter. Use emea for Europe/Middle East/Africa."),
  grain: z
    .enum(["monthly", "quarterly"])
    .optional()
    .describe("Time grain of the series."),
  currency: z
    .enum(["reported", "constant"])
    .optional()
    .describe(
      "reported = as booked; constant = constant currency, which removes FX " +
        "movement and gives a different figure outside NAMER.",
    ),
};
