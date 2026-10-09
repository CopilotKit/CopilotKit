// Presentation vocabulary for the Charges page.
//
// This file used to carry its own 45-row `CHARGES` fixture, kept deliberately
// "independent of the seeded transaction store". That independence was the bug:
// the app ended up with three disagreeing answers to "what did we spend" — this
// fixture ($632,806), the seeded ledger ($30,089, only two months, which made
// the report's trend chart fall back to hard-coded numbers), and the policy
// totals ($137,000). Those 45 charges now live in the ledger itself
// (`data/seed.json`), so every surface reads one source over
// `/api/banking/v1/transactions`.
//
// What remains here is only what the *page* needs that the ledger does not
// model: the filter vocabularies, and the display status — which includes
// `over-limit`, a value no transaction stores because it is derived from the
// charge's amount against its policy's remaining headroom.

import { CHARGE_CATEGORIES, CHARGE_TEAMS } from "@/skins/banking/data/data";
import type {
  ChargeCategory,
  ChargeTeam,
  Transaction,
} from "@/skins/banking/data/data";

export { CHARGE_CATEGORIES, CHARGE_TEAMS };
export type { ChargeCategory, ChargeTeam };

/**
 * The statuses the Charges table can display.
 *
 * A superset of `Transaction["status"]`: `over-limit` is derived per row via
 * `isOverLimit`, and `denied` is omitted because the seeded ledger contains
 * none (a denied charge is rendered by its stored status if one ever appears).
 */
export const CHARGE_STATUSES = [
  "approved",
  "pending",
  "flagged",
  "over-limit",
] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

/**
 * One row of the Charges table: a ledger transaction flattened for display,
 * with spend as a positive number and the over-limit status resolved.
 */
export interface ChargeRow {
  id: string;
  merchant: string;
  /**
   * Display strings rather than the strict vocabularies: a Transaction's team
   * and category are optional (a report's synthetic additions have neither), so
   * a row renders a dash instead of the page having to exclude such rows.
   */
  category: string;
  team: string;
  /** USD, positive = spend (the ledger stores spend as negative). */
  amount: number;
  /** ISO yyyy-mm-dd. */
  date: string;
  status: ChargeStatus;
}

/** Shown when a transaction carries no team/category (see `ChargeRow`). */
const UNATTRIBUTED = "—";

/**
 * Project a ledger transaction onto a table row.
 *
 * `overLimit` is passed in rather than recomputed here so the page derives it
 * once via `withOverLimit` (the single source of truth for that rule) instead
 * of this module forming a second opinion about policy headroom.
 */
export const toChargeRow = (t: Transaction, overLimit: boolean): ChargeRow => ({
  id: t.id,
  merchant: t.title,
  category: t.category ?? UNATTRIBUTED,
  team: t.team ?? UNATTRIBUTED,
  amount: Math.abs(t.amount),
  date: t.date,
  status:
    overLimit && t.status === "pending"
      ? "over-limit"
      : toDisplayStatus(t.status),
});

const toDisplayStatus = (s: Transaction["status"]): ChargeStatus =>
  // `denied` has no chip of its own; it reads as pending review in the table.
  s === "denied" ? "pending" : s;

export const SORT_KEYS = [
  "amount_desc",
  "amount_asc",
  "date_desc",
  "date_asc",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/**
 * Narrow a `?sort=` value to a real sort key, or `null` when unrecognised.
 *
 * `null` matters as much as the happy path: the page tints the Sort control to
 * signal "this view is deliberately sorted", and it keys that tint on this
 * result. The param used to be cast straight to `SortKey`, so `?sort=banana`
 * lit the tint while no `<option>` matched and the table silently fell back to
 * amount_desc — the control asserted a filter it was not applying.
 */
export const parseSort = (raw: string | null): SortKey | null =>
  raw !== null && (SORT_KEYS as readonly string[]).includes(raw)
    ? (raw as SortKey)
    : null;

/**
 * Narrow a `?top=` value to a positive row count, or `null`.
 *
 * Rejects zero, negatives and fractions. `?top=-5` previously reached
 * `rows.slice(0, -5)`, which drops the LAST five rows — inverting the meaning
 * of top-N rather than failing.
 */
export const parseTop = (raw: string | null): number | null => {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};
