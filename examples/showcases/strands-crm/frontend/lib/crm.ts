export type Stage =
  | "Lead"
  | "Qualified"
  | "Proposal"
  | "Negotiation"
  | "Closed Won"
  | "Closed Lost";

export const STAGES: Stage[] = [
  "Lead",
  "Qualified",
  "Proposal",
  "Negotiation",
  "Closed Won",
  "Closed Lost",
];

export type ProductCategory =
  | "Laptop"
  | "Workstation"
  | "Server"
  | "Display"
  | "Accessory";
export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  sku: string;
  unitPrice: number;
  photoUrl: string;
  specs: string;
  blurb: string;
}
export interface Salesperson {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  role: "AE" | "SDR" | "Manager";
  region: string;
  quota: number;
}
export interface DealLineItem {
  productId: string;
  qty: number;
  unitPrice: number;
}
export interface ReportMetrics {
  bookings: number;
  weightedForecast: number;
  winRate: number | null;
  dealsWon: number;
  dealsOpen: number;
  byStage: { stage: Stage; count: number; value: number }[];
  byCategory: { category: ProductCategory; value: number }[];
  leaderboard: {
    salespersonId: string;
    name: string;
    bookings: number;
    attainment: number;
  }[];
}
export interface Report {
  id: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  summary: string;
  metrics: ReportMetrics;
  highlights: string[];
}
export interface QuoteLineItem {
  productId: string;
  name: string;
  category: ProductCategory;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  photoUrl: string;
}
export interface Quote {
  id: string;
  accountId: string;
  accountName: string;
  useCase?: string;
  seats?: number;
  lineItems: QuoteLineItem[];
  subtotal: number;
  note?: string;
  status: "approved";
  createdAt: string;
}

export interface Account {
  id: string;
  name: string;
  domain: string;
  industry?: string;
  sizeEmployees?: number;
  location?: string;
  enrichment?: EnrichmentResult;
}
export interface Contact {
  id: string;
  accountId: string;
  name: string;
  title: string;
  email: string;
}
export interface Deal {
  id: string;
  accountId: string;
  name: string;
  amount: number;
  stage: Stage;
  probability: number;
  closeDate: string;
  ownerName: string;
  ownerId: string;
  lineItems: DealLineItem[];
}
export interface Activity {
  id: string;
  dealId: string;
  type: "note" | "email" | "call" | "meeting";
  body: string;
  createdAt: string;
}
export interface EnrichmentResult {
  summary: string;
  sizeEmployees?: number;
  recentNews: { title: string; url: string }[];
  talkingPoints: string[];
  sources: { title: string; url: string }[];
  enrichedAt: string;
}
export interface CrmState {
  deals: Deal[];
  accounts: Account[];
  contacts: Contact[];
  activities: Activity[];
  products: Product[];
  salespeople: Salesperson[];
  reports: Report[];
  quotes: Quote[];
}

export const STAGE_STYLES: Record<Stage, string> = {
  Lead: "bg-slate-100 text-slate-700",
  Qualified: "bg-sky-100 text-sky-700",
  Proposal: "bg-violet-100 text-violet-700",
  Negotiation: "bg-amber-100 text-amber-700",
  "Closed Won": "bg-emerald-100 text-emerald-700",
  "Closed Lost": "bg-rose-100 text-rose-700",
};

export const CATEGORY_STYLES: Record<ProductCategory, string> = {
  Laptop: "bg-blue-100 text-blue-700",
  Workstation: "bg-indigo-100 text-indigo-700",
  Server: "bg-cyan-100 text-cyan-700",
  Display: "bg-sky-100 text-sky-700",
  Accessory: "bg-slate-100 text-slate-700",
};

export function groupDealsByStage(deals: Deal[]): Record<Stage, Deal[]> {
  const out = Object.fromEntries(
    STAGES.map((s) => [s, [] as Deal[]]),
  ) as Record<Stage, Deal[]>;
  for (const d of deals) out[d.stage].push(d);
  return out;
}

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export type Risk = "low" | "medium" | "high";

export function dealRisk(deal: Deal, now: number = Date.now()): Risk {
  if (deal.stage === "Closed Won" || deal.stage === "Closed Lost") return "low";
  const days = (new Date(deal.closeDate).getTime() - now) / 86_400_000;
  if (deal.probability < 35 || days < 0) return "high";
  if (deal.probability < 65 || days < 14) return "medium";
  return "low";
}

export interface Kpis {
  openPipeline: number;
  weightedForecast: number;
  winRate: number | null;
  atRisk: number;
}

export function computeKpis(crm: CrmState, now: number = Date.now()): Kpis {
  const open = crm.deals.filter(
    (d) => d.stage !== "Closed Won" && d.stage !== "Closed Lost",
  );
  const won = crm.deals.filter((d) => d.stage === "Closed Won").length;
  const lost = crm.deals.filter((d) => d.stage === "Closed Lost").length;
  return {
    openPipeline: open.reduce((s, d) => s + d.amount, 0),
    weightedForecast: Math.round(
      open.reduce((s, d) => s + d.amount * (d.probability / 100), 0),
    ),
    winRate: won + lost === 0 ? null : won / (won + lost),
    atRisk: open.filter((d) => dealRisk(d, now) !== "low").length,
  };
}

/** Apply an optimistic {dealId -> Stage} overlay on top of a base snapshot.
 *  Returns the same object when the overlay is empty (cheap identity). */
export function applyStageOverlay(
  base: CrmState,
  overlay: Record<string, Stage>,
): CrmState {
  if (Object.keys(overlay).length === 0) return base;
  return {
    ...base,
    deals: base.deals.map((d) => {
      const s = overlay[d.id];
      if (!s || s === d.stage) return d;
      const probability =
        s === "Closed Won" ? 100 : s === "Closed Lost" ? 0 : d.probability;
      return { ...d, stage: s, probability };
    }),
  };
}

/** Drop overlay entries the base snapshot already reflects (or whose deal is gone),
 *  so a reflected/superseded optimistic move can never resurrect over a newer snapshot. */
export function pruneOverlay(
  base: CrmState,
  overlay: Record<string, Stage>,
): Record<string, Stage> {
  const next: Record<string, Stage> = {};
  for (const [id, stage] of Object.entries(overlay)) {
    const d = base.deals.find((x) => x.id === id);
    if (d && d.stage !== stage) next[id] = stage;
  }
  return next;
}

/** Compact relative timestamp ("30m ago", "3h ago", "3d ago"), date for >30d. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const MIN = 60_000,
    HR = 3_600_000,
    DAY = 86_400_000;
  const sign = (n: number, unit: string) =>
    diff >= 0 ? `${n}${unit} ago` : `in ${n}${unit}`;
  if (abs < HR) return sign(Math.max(1, Math.round(abs / MIN)), "m");
  if (abs < DAY) return sign(Math.round(abs / HR), "h");
  const d = Math.round(abs / DAY);
  if (d < 30) return sign(d, "d");
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Analytics helpers (pure; mirrored 1:1 by the backend `src/crm/analytics.ts`).
// All month math is UTC-based and deterministic so charts stay pixel-stable.
// ---------------------------------------------------------------------------

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

const isOpen = (d: Deal): boolean =>
  d.stage !== "Closed Won" && d.stage !== "Closed Lost";
const isWon = (d: Deal): boolean => d.stage === "Closed Won";

/** "YYYY-MM" key from an ISO date string (uses the leading 7 chars). */
function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** The last `count` calendar months ending at `now`, ascending (oldest first). */
function monthBuckets(
  now: number,
  count = 8,
): { month: string; label: string }[] {
  const base = new Date(now);
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth(); // 0..11
  const out: { month: string; label: string }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - i, 1));
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    out.push({
      month: `${dt.getUTCFullYear()}-${mm}`,
      label: MONTH_LABELS[dt.getUTCMonth()],
    });
  }
  return out;
}

export interface SalesOverTimePoint {
  month: string;
  label: string;
  bookings: number;
}

/** Closed-Won amount summed by closeDate month, across the last 8 months
 *  (ascending). Zero months are included so the series is always length 8. */
export function salesOverTime(
  crm: CrmState,
  now: number = Date.now(),
): SalesOverTimePoint[] {
  const buckets = monthBuckets(now, 8);
  const sums = new Map<string, number>(buckets.map((b) => [b.month, 0]));
  for (const d of crm.deals) {
    if (!isWon(d)) continue;
    const key = monthKey(d.closeDate);
    if (sums.has(key)) sums.set(key, sums.get(key)! + d.amount);
  }
  return buckets.map((b) => ({
    month: b.month,
    label: b.label,
    bookings: sums.get(b.month)!,
  }));
}

export interface CategoryRevenue {
  category: ProductCategory;
  value: number;
}

/** Open-pipeline revenue (Σ qty × unitPrice of OPEN deals' line items) grouped
 *  by the product category. Categories that sum to zero are skipped. */
export function revenueByCategory(crm: CrmState): CategoryRevenue[] {
  const byProduct = new Map(crm.products.map((p) => [p.id, p]));
  const sums = new Map<ProductCategory, number>();
  for (const d of crm.deals) {
    if (!isOpen(d)) continue;
    for (const li of d.lineItems) {
      const cat = byProduct.get(li.productId)?.category;
      if (!cat) continue;
      sums.set(cat, (sums.get(cat) ?? 0) + li.qty * li.unitPrice);
    }
  }
  return [...sums.entries()]
    .filter(([, v]) => v > 0)
    .map(([category, value]) => ({ category, value }));
}

export interface LeaderboardRow {
  salespersonId: string;
  name: string;
  bookings: number;
  openPipeline: number;
  attainment: number;
  quota: number;
  dealCount: number;
}

/** Per-rep aggregates sorted by bookings (Closed-Won $) descending.
 *  `attainment` = bookings / quota (0 when quota is 0). `now` is accepted for
 *  signature parity with the other analytics helpers (bookings are all-time). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function teamLeaderboard(
  crm: CrmState,
  now: number = Date.now(),
): LeaderboardRow[] {
  return crm.salespeople
    .map((rep) => {
      const deals = crm.deals.filter((d) => d.ownerId === rep.id);
      const bookings = deals.filter(isWon).reduce((s, d) => s + d.amount, 0);
      const openPipeline = deals
        .filter(isOpen)
        .reduce((s, d) => s + d.amount, 0);
      return {
        salespersonId: rep.id,
        name: rep.name,
        bookings,
        openPipeline,
        attainment: rep.quota > 0 ? bookings / rep.quota : 0,
        quota: rep.quota,
        dealCount: deals.length,
      };
    })
    .sort((a, b) => b.bookings - a.bookings);
}

export interface RepStats {
  rep: Salesperson;
  bookings: number;
  openPipeline: number;
  attainment: number;
  winRate: number | null;
  dealCount: number;
  trend: number[]; // 8 monthly Closed-Won totals, ascending
  deals: Deal[];
}

/** Full stats for one rep, or `null` if the rep id is unknown.
 *  `trend` is the rep's Closed-Won $ over the last 8 months (ascending). */
export function repStats(
  crm: CrmState,
  repId: string,
  now: number = Date.now(),
): RepStats | null {
  const rep = crm.salespeople.find((s) => s.id === repId);
  if (!rep) return null;
  const deals = crm.deals.filter((d) => d.ownerId === repId);
  const wonDeals = deals.filter(isWon);
  const bookings = wonDeals.reduce((s, d) => s + d.amount, 0);
  const openPipeline = deals.filter(isOpen).reduce((s, d) => s + d.amount, 0);
  const won = wonDeals.length;
  const lost = deals.filter((d) => d.stage === "Closed Lost").length;
  const buckets = monthBuckets(now, 8);
  const sums = new Map<string, number>(buckets.map((b) => [b.month, 0]));
  for (const d of wonDeals) {
    const key = monthKey(d.closeDate);
    if (sums.has(key)) sums.set(key, sums.get(key)! + d.amount);
  }
  return {
    rep,
    bookings,
    openPipeline,
    attainment: rep.quota > 0 ? bookings / rep.quota : 0,
    winRate: won + lost === 0 ? null : won / (won + lost),
    dealCount: deals.length,
    trend: buckets.map((b) => sums.get(b.month)!),
    deals,
  };
}

export interface TeamStats {
  totalBookings: number;
  weightedForecast: number;
  winRate: number | null;
  leaderboard: LeaderboardRow[];
  byCategory: CategoryRevenue[];
}

/** Whole-team aggregates + per-rep leaderboard (bookings desc, ties broken by
 *  salesperson id). Mirrors `teamStats` in src/crm/analytics.ts so the Team
 *  Reports page and the copilot agree to the dollar. */
export function teamStats(crm: CrmState, now: number = Date.now()): TeamStats {
  const totalBookings = crm.deals
    .filter(isWon)
    .reduce((s, d) => s + d.amount, 0);
  const weightedForecast = Math.round(
    crm.deals
      .filter(isOpen)
      .reduce((s, d) => s + d.amount * (d.probability / 100), 0),
  );
  const won = crm.deals.filter(isWon).length;
  const lost = crm.deals.filter((d) => d.stage === "Closed Lost").length;
  const winRate = won + lost === 0 ? null : won / (won + lost);
  const leaderboard = teamLeaderboard(crm, now)
    .slice()
    .sort(
      (a, b) =>
        b.bookings - a.bookings ||
        a.salespersonId.localeCompare(b.salespersonId),
    );
  return {
    totalBookings,
    weightedForecast,
    winRate,
    leaderboard,
    byCategory: revenueByCategory(crm),
  };
}
