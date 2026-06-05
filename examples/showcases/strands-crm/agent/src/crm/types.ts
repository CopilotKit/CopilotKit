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

export const OPEN_STAGES: Stage[] = [
  "Lead",
  "Qualified",
  "Proposal",
  "Negotiation",
];

export function isValidStage(s: string): s is Stage {
  return (STAGES as string[]).includes(s);
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
  probability: number; // 0..100
  closeDate: string; // ISO yyyy-mm-dd
  ownerName: string;
  ownerId: string; // references Salesperson.id
  lineItems: DealLineItem[]; // amount === Σ qty×unitPrice
}

export interface Activity {
  id: string;
  dealId: string;
  type: "note" | "email" | "call" | "meeting";
  body: string;
  createdAt: string; // ISO
}

export interface EnrichmentResult {
  summary: string;
  sizeEmployees?: number;
  recentNews: { title: string; url: string }[];
  talkingPoints: string[];
  sources: { title: string; url: string }[];
  enrichedAt: string; // ISO
}

// ---------------------------------------------------------------------------
// Enterprise-hardware entities (mirrored verbatim in frontend/lib/crm.ts)
// ---------------------------------------------------------------------------

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
  createdAt: string; // ISO
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

export interface DealBrief {
  dealId: string;
  dealName: string;
  accountName: string;
  stage: Stage;
  amount: number;
  probability: number;
  keyContact?: { name: string; title: string; email: string };
  lastActivity?: { type: Activity["type"]; body: string; createdAt: string };
  risk: "low" | "medium" | "high";
  nextStep: string;
}
