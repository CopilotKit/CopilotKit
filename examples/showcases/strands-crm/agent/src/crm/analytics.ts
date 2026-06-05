/**
 * Server-side sales analytics for the Northstar enterprise-hardware CRM.
 *
 * Every function is PURE: it reads a `CrmState` snapshot (plus, where time
 * matters, an injectable `now = Date.now()` for determinism) and returns plain
 * data — no DB access, no `Date.now()` in the hot path unless defaulted.
 *
 * These formulas are mirrored verbatim in `frontend/lib/crm.ts` (single
 * formula, two call sites) so the dashboard and the copilot agree to the dollar.
 *
 * Definitions (shared vocabulary):
 *   - OPEN deal      → stage ∈ {Lead, Qualified, Proposal, Negotiation}.
 *   - bookings       → Σ amount of Closed-Won deals (optionally within a period).
 *   - weightedForecast → Σ amount × probability/100 over OPEN deals.
 *   - winRate        → won / (won + lost), or null when both are 0.
 */

import type {
  CrmState,
  Deal,
  ProductCategory,
  ReportMetrics,
  Salesperson,
  Stage,
} from "./types.js";
import { OPEN_STAGES, STAGES } from "./types.js";

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

const ALL_CATEGORIES: ProductCategory[] = [
  "Laptop",
  "Workstation",
  "Server",
  "Display",
  "Accessory",
];

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function isOpen(deal: Deal): boolean {
  return (OPEN_STAGES as string[]).includes(deal.stage);
}

/** Closed-Won deals, optionally restricted to closeDate within [start, end] (inclusive, ISO dates). */
function wonDeals(
  crm: CrmState,
  periodStart?: string,
  periodEnd?: string,
): Deal[] {
  return crm.deals.filter((d) => {
    if (d.stage !== "Closed Won") return false;
    if (periodStart && d.closeDate < periodStart) return false;
    if (periodEnd && d.closeDate > periodEnd) return false;
    return true;
  });
}

/** Map productId → category from the catalog (unknown products are ignored). */
function categoryByProduct(crm: CrmState): Map<string, ProductCategory> {
  return new Map(crm.products.map((p) => [p.id, p.category]));
}

// ---------------------------------------------------------------------------
// Headline scalars
// ---------------------------------------------------------------------------

/** Σ amount of Closed-Won deals (optionally within a closeDate period). */
export function bookings(
  crm: CrmState,
  periodStart?: string,
  periodEnd?: string,
): number {
  return wonDeals(crm, periodStart, periodEnd).reduce(
    (sum, d) => sum + d.amount,
    0,
  );
}

/** Σ amount × probability/100 over OPEN deals. */
export function weightedForecast(crm: CrmState): number {
  return Math.round(
    crm.deals
      .filter(isOpen)
      .reduce((sum, d) => sum + d.amount * (d.probability / 100), 0),
  );
}

/** won / (won + lost); null when there are no closed deals at all. */
export function winRate(crm: CrmState): number | null {
  const won = crm.deals.filter((d) => d.stage === "Closed Won").length;
  const lost = crm.deals.filter((d) => d.stage === "Closed Lost").length;
  if (won + lost === 0) return null;
  return won / (won + lost);
}

// ---------------------------------------------------------------------------
// Sales over time (trend)
// ---------------------------------------------------------------------------

export interface SalesPoint {
  month: string;
  label: string;
  bookings: number;
}

/**
 * Last 8 months ascending, ending with the month that contains `now`.
 * Each bucket sums Closed-Won `amount` whose `closeDate` falls in that month.
 * Zero months are included so the series is always length 8.
 *
 * `month` is "YYYY-MM"; `label` is the 3-letter month name (e.g. "Jun").
 * Month math uses UTC to stay deterministic regardless of the host timezone.
 */
export function salesOverTime(
  crm: CrmState,
  now: number = Date.now(),
): SalesPoint[] {
  const ref = new Date(now);
  const endYear = ref.getUTCFullYear();
  const endMonth = ref.getUTCMonth(); // 0-based

  // Pre-bucket Closed-Won amounts by "YYYY-MM" of closeDate.
  const byMonth = new Map<string, number>();
  for (const d of crm.deals) {
    if (d.stage !== "Closed Won") continue;
    const key = d.closeDate.slice(0, 7); // ISO "YYYY-MM-DD" → "YYYY-MM"
    byMonth.set(key, (byMonth.get(key) ?? 0) + d.amount);
  }

  const points: SalesPoint[] = [];
  for (let i = 7; i >= 0; i--) {
    // Walk back i months from the reference month using UTC arithmetic.
    const dt = new Date(Date.UTC(endYear, endMonth - i, 1));
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth(); // 0-based
    const month = `${y}-${String(m + 1).padStart(2, "0")}`;
    points.push({
      month,
      label: MONTH_LABELS[m],
      bookings: byMonth.get(month) ?? 0,
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Revenue by category (open pipeline composition)
// ---------------------------------------------------------------------------

export interface CategoryValue {
  category: ProductCategory;
  value: number;
}

/**
 * Σ(qty × unitPrice) of OPEN deals' line items, grouped by product category.
 * Categories with zero value are skipped. Output order follows the canonical
 * category order (Laptop, Workstation, Server, Display, Accessory).
 */
export function revenueByCategory(crm: CrmState): CategoryValue[] {
  const catOf = categoryByProduct(crm);
  const totals = new Map<ProductCategory, number>();
  for (const deal of crm.deals) {
    if (!isOpen(deal)) continue;
    for (const item of deal.lineItems) {
      const cat = catOf.get(item.productId);
      if (!cat) continue;
      totals.set(cat, (totals.get(cat) ?? 0) + item.qty * item.unitPrice);
    }
  }
  return ALL_CATEGORIES.map((category) => ({
    category,
    value: totals.get(category) ?? 0,
  })).filter((c) => c.value > 0);
}

// ---------------------------------------------------------------------------
// Team stats (manager view)
// ---------------------------------------------------------------------------

export interface LeaderboardRow {
  salespersonId: string;
  name: string;
  bookings: number;
  openPipeline: number;
  attainment: number; // bookings / quota (0 when quota is 0)
  quota: number;
  dealCount: number;
}

export interface TeamStats {
  totalBookings: number;
  weightedForecast: number;
  winRate: number | null;
  leaderboard: LeaderboardRow[];
  byCategory: CategoryValue[];
}

/**
 * Whole-team aggregates plus a per-rep leaderboard (sorted by bookings desc,
 * ties broken by salesperson id for determinism). `attainment` is
 * bookings/quota (0 when quota is 0, e.g. a Manager). `dealCount` counts every
 * deal the rep owns (any stage).
 */
export function teamStats(crm: CrmState, _now: number = Date.now()): TeamStats {
  const leaderboard: LeaderboardRow[] = crm.salespeople.map((rep) => {
    const owned = crm.deals.filter((d) => d.ownerId === rep.id);
    const repBookings = owned
      .filter((d) => d.stage === "Closed Won")
      .reduce((sum, d) => sum + d.amount, 0);
    const openPipeline = owned
      .filter(isOpen)
      .reduce((sum, d) => sum + d.amount, 0);
    return {
      salespersonId: rep.id,
      name: rep.name,
      bookings: repBookings,
      openPipeline,
      attainment: rep.quota > 0 ? repBookings / rep.quota : 0,
      quota: rep.quota,
      dealCount: owned.length,
    };
  });

  leaderboard.sort(
    (a, b) =>
      b.bookings - a.bookings || a.salespersonId.localeCompare(b.salespersonId),
  );

  return {
    totalBookings: bookings(crm),
    weightedForecast: weightedForecast(crm),
    winRate: winRate(crm),
    leaderboard,
    byCategory: revenueByCategory(crm),
  };
}

// ---------------------------------------------------------------------------
// Per-rep stats (drill-in)
// ---------------------------------------------------------------------------

export interface RepStats {
  rep: Salesperson;
  bookings: number;
  openPipeline: number;
  attainment: number;
  winRate: number | null;
  dealCount: number;
  trend: number[]; // this rep's monthly Closed-Won bookings, length 8, ascending
  deals: Deal[]; // every deal this rep owns
}

/**
 * Stats for one salesperson. `trend` is their own monthly Closed-Won bookings
 * over the same 8-month window as `salesOverTime` (length 8, ascending).
 * Throws if `repId` is unknown.
 */
export function repStats(
  crm: CrmState,
  repId: string,
  now: number = Date.now(),
): RepStats {
  const rep = crm.salespeople.find((s) => s.id === repId);
  if (!rep) throw new Error(`salesperson not found: ${repId}`);

  const owned = crm.deals.filter((d) => d.ownerId === repId);
  const repBookings = owned
    .filter((d) => d.stage === "Closed Won")
    .reduce((sum, d) => sum + d.amount, 0);
  const openPipeline = owned
    .filter(isOpen)
    .reduce((sum, d) => sum + d.amount, 0);
  const won = owned.filter((d) => d.stage === "Closed Won").length;
  const lost = owned.filter((d) => d.stage === "Closed Lost").length;

  // Reuse the shared month window, but bucket only this rep's won deals.
  const repCrm: CrmState = { ...crm, deals: owned };
  const trend = salesOverTime(repCrm, now).map((p) => p.bookings);

  return {
    rep,
    bookings: repBookings,
    openPipeline,
    attainment: rep.quota > 0 ? repBookings / rep.quota : 0,
    winRate: won + lost === 0 ? null : won / (won + lost),
    dealCount: owned.length,
    trend,
    deals: owned,
  };
}

// ---------------------------------------------------------------------------
// Weekly report metrics
// ---------------------------------------------------------------------------

/**
 * Build a full `ReportMetrics` for the [periodStart, periodEnd] window (inclusive
 * ISO dates).
 *   - bookings    → Closed-Won with closeDate in the period.
 *   - weightedForecast → over all OPEN deals (current pipeline, period-independent).
 *   - winRate     → overall won/(won+lost) (period-independent).
 *   - dealsWon    → count of Closed-Won in the period.
 *   - dealsOpen   → count of currently OPEN deals.
 *   - byStage     → count + Σ amount per stage (all stages, current snapshot).
 *   - byCategory  → open-pipeline revenue by category.
 *   - leaderboard → per-rep in-period bookings + attainment, sorted desc.
 */
export function weeklyReportMetrics(
  crm: CrmState,
  periodStart: string,
  periodEnd: string,
  _now: number = Date.now(),
): ReportMetrics {
  const periodWon = wonDeals(crm, periodStart, periodEnd);

  const byStage = (STAGES as Stage[]).map((stage) => {
    const inStage = crm.deals.filter((d) => d.stage === stage);
    return {
      stage,
      count: inStage.length,
      value: inStage.reduce((sum, d) => sum + d.amount, 0),
    };
  });

  const leaderboard = crm.salespeople
    .map((rep) => {
      const repBookings = periodWon
        .filter((d) => d.ownerId === rep.id)
        .reduce((sum, d) => sum + d.amount, 0);
      return {
        salespersonId: rep.id,
        name: rep.name,
        bookings: repBookings,
        attainment: rep.quota > 0 ? repBookings / rep.quota : 0,
      };
    })
    .sort(
      (a, b) =>
        b.bookings - a.bookings ||
        a.salespersonId.localeCompare(b.salespersonId),
    );

  return {
    bookings: bookings(crm, periodStart, periodEnd),
    weightedForecast: weightedForecast(crm),
    winRate: winRate(crm),
    dealsWon: periodWon.length,
    dealsOpen: crm.deals.filter(isOpen).length,
    byStage,
    byCategory: revenueByCategory(crm),
    leaderboard,
  };
}
