import type { DatabaseSync } from "node:sqlite";
import { initDb } from "./db.js";
import { isValidStage } from "./types.js";
import type {
  Account,
  Activity,
  Contact,
  CrmState,
  Deal,
  DealLineItem,
  EnrichmentResult,
  Product,
  ProductCategory,
  Quote,
  QuoteLineItem,
  Report,
  ReportMetrics,
  Salesperson,
  Stage,
} from "./types.js";

// ---------------------------------------------------------------------------
// Row → domain-type mappers
// ---------------------------------------------------------------------------

type DealRow = {
  id: string;
  accountId: string;
  name: string;
  amount: number;
  stage: string;
  probability: number;
  closeDate: string;
  ownerName: string;
  ownerId: string;
  lineItems: string;
};

type ProductRow = {
  id: string;
  name: string;
  category: string;
  sku: string;
  unitPrice: number;
  photoUrl: string;
  specs: string;
  blurb: string;
};

type SalespersonRow = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  role: string;
  region: string;
  quota: number;
};

type ReportRow = {
  id: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  summary: string;
  metrics: string;
  highlights: string;
};

type QuoteRow = {
  id: string;
  accountId: string;
  accountName: string;
  useCase: string | null;
  seats: number | null;
  lineItems: string;
  subtotal: number;
  note: string | null;
  status: string;
  createdAt: string;
};

type AccountRow = {
  id: string;
  name: string;
  domain: string;
  industry: string | null;
  sizeEmployees: number | null;
  location: string | null;
  enrichment: string | null;
};

type ContactRow = {
  id: string;
  accountId: string;
  name: string;
  title: string;
  email: string;
};

type ActivityRow = {
  id: string;
  dealId: string;
  type: string;
  body: string;
  createdAt: string;
};

function rowToDeal(row: DealRow): Deal {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    amount: row.amount,
    stage: row.stage as Stage,
    probability: row.probability,
    closeDate: row.closeDate,
    ownerName: row.ownerName,
    ownerId: row.ownerId,
    lineItems: row.lineItems
      ? (JSON.parse(row.lineItems) as DealLineItem[])
      : [],
  };
}

function rowToProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    category: row.category as ProductCategory,
    sku: row.sku,
    unitPrice: row.unitPrice,
    photoUrl: row.photoUrl,
    specs: row.specs,
    blurb: row.blurb,
  };
}

function rowToSalesperson(row: SalespersonRow): Salesperson {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatarUrl,
    role: row.role as Salesperson["role"],
    region: row.region,
    quota: row.quota,
  };
}

function rowToReport(row: ReportRow): Report {
  return {
    id: row.id,
    title: row.title,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    generatedAt: row.generatedAt,
    summary: row.summary,
    metrics: JSON.parse(row.metrics) as ReportMetrics,
    highlights: JSON.parse(row.highlights) as string[],
  };
}

function rowToQuote(row: QuoteRow): Quote {
  const q: Quote = {
    id: row.id,
    accountId: row.accountId,
    accountName: row.accountName,
    lineItems: row.lineItems
      ? (JSON.parse(row.lineItems) as QuoteLineItem[])
      : [],
    subtotal: row.subtotal,
    status: row.status as Quote["status"],
    createdAt: row.createdAt,
  };
  if (row.useCase != null) q.useCase = row.useCase;
  if (row.seats != null) q.seats = row.seats;
  if (row.note != null) q.note = row.note;
  return q;
}

function rowToAccount(row: AccountRow): Account {
  const acct: Account = {
    id: row.id,
    name: row.name,
    domain: row.domain,
  };
  if (row.industry != null) acct.industry = row.industry;
  if (row.sizeEmployees != null) acct.sizeEmployees = row.sizeEmployees;
  if (row.location != null) acct.location = row.location;
  if (row.enrichment != null) acct.enrichment = JSON.parse(row.enrichment);
  return acct;
}

function rowToContact(row: ContactRow): Contact {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    title: row.title,
    email: row.email,
  };
}

function rowToActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    dealId: row.dealId,
    type: row.type as Activity["type"],
    body: row.body,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// CrmStore
// ---------------------------------------------------------------------------

export class CrmStore {
  private db: DatabaseSync;

  /**
   * Optional `db` arg lets tests inject an in-memory DB.
   * The default uses `:memory:` during vitest runs (process.env.VITEST is set
   * by vitest) so test runs never touch data/northstar.db and always start
   * from a fresh seed. At runtime (npm run dev) it opens the persistent file.
   */
  constructor(db?: DatabaseSync) {
    this.db = db ?? initDb(process.env.VITEST ? ":memory:" : undefined);
  }

  getStateSnapshot(): CrmState {
    const deals = (
      this.db.prepare("SELECT * FROM deals").all() as DealRow[]
    ).map(rowToDeal);
    const accounts = (
      this.db.prepare("SELECT * FROM accounts").all() as AccountRow[]
    ).map(rowToAccount);
    const contacts = (
      this.db.prepare("SELECT * FROM contacts").all() as ContactRow[]
    ).map(rowToContact);
    const activities = (
      this.db.prepare("SELECT * FROM activities").all() as ActivityRow[]
    ).map(rowToActivity);
    const products = (
      this.db.prepare("SELECT * FROM products").all() as ProductRow[]
    ).map(rowToProduct);
    const salespeople = (
      this.db.prepare("SELECT * FROM salespeople").all() as SalespersonRow[]
    ).map(rowToSalesperson);
    const reports = (
      this.db
        .prepare("SELECT * FROM reports ORDER BY generatedAt DESC")
        .all() as ReportRow[]
    ).map(rowToReport);
    const quotes = (
      this.db
        .prepare("SELECT * FROM quotes ORDER BY createdAt DESC")
        .all() as QuoteRow[]
    ).map(rowToQuote);
    // Each call returns fresh objects from the DB — already independent deep copies.
    return {
      deals,
      accounts,
      contacts,
      activities,
      products,
      salespeople,
      reports,
      quotes,
    };
  }

  getDeal(id: string): Deal | undefined {
    const row = this.db.prepare("SELECT * FROM deals WHERE id = ?").get(id) as
      | DealRow
      | undefined;
    return row ? rowToDeal(row) : undefined;
  }

  getAccount(id: string): Account | undefined {
    const row = this.db
      .prepare("SELECT * FROM accounts WHERE id = ?")
      .get(id) as AccountRow | undefined;
    return row ? rowToAccount(row) : undefined;
  }

  contactsForAccount(accountId: string): Contact[] {
    return (
      this.db
        .prepare("SELECT * FROM contacts WHERE accountId = ?")
        .all(accountId) as ContactRow[]
    ).map(rowToContact);
  }

  activitiesForDeal(dealId: string): Activity[] {
    return (
      this.db
        .prepare("SELECT * FROM activities WHERE dealId = ?")
        .all(dealId) as ActivityRow[]
    ).map(rowToActivity);
  }

  findAccountByName(query: string): Account | undefined {
    const q = query.trim().toLowerCase();
    const all = (
      this.db.prepare("SELECT * FROM accounts").all() as AccountRow[]
    ).map(rowToAccount);
    return (
      all.find((a) => a.name.toLowerCase() === q) ??
      all.find((a) => a.name.toLowerCase().includes(q)) ??
      all.find((a) => a.domain.toLowerCase().includes(q))
    );
  }

  // ---- Products -----------------------------------------------------------

  listProducts(): Product[] {
    return (
      this.db.prepare("SELECT * FROM products").all() as ProductRow[]
    ).map(rowToProduct);
  }

  getProduct(id: string): Product | undefined {
    const row = this.db
      .prepare("SELECT * FROM products WHERE id = ?")
      .get(id) as ProductRow | undefined;
    return row ? rowToProduct(row) : undefined;
  }

  // ---- Salespeople --------------------------------------------------------

  listSalespeople(): Salesperson[] {
    return (
      this.db.prepare("SELECT * FROM salespeople").all() as SalespersonRow[]
    ).map(rowToSalesperson);
  }

  getSalesperson(id: string): Salesperson | undefined {
    const row = this.db
      .prepare("SELECT * FROM salespeople WHERE id = ?")
      .get(id) as SalespersonRow | undefined;
    return row ? rowToSalesperson(row) : undefined;
  }

  /** Case-insensitive fuzzy lookup: exact name, then substring (name or email). */
  findSalespersonByName(query: string): Salesperson | undefined {
    const q = query.trim().toLowerCase();
    const all = this.listSalespeople();
    return (
      all.find((s) => s.name.toLowerCase() === q) ??
      all.find((s) => s.name.toLowerCase().includes(q)) ??
      all.find((s) => s.email.toLowerCase().includes(q))
    );
  }

  // ---- Reports ------------------------------------------------------------

  /** Newest first (by generatedAt). */
  listReports(): Report[] {
    return (
      this.db
        .prepare("SELECT * FROM reports ORDER BY generatedAt DESC")
        .all() as ReportRow[]
    ).map(rowToReport);
  }

  addReport(report: Report): Report {
    this.db
      .prepare(
        "INSERT INTO reports (id, title, periodStart, periodEnd, generatedAt, summary, metrics, highlights) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        report.id,
        report.title,
        report.periodStart,
        report.periodEnd,
        report.generatedAt,
        report.summary,
        JSON.stringify(report.metrics),
        JSON.stringify(report.highlights),
      );
    return report;
  }

  // ---- Quotes -------------------------------------------------------------

  /** Newest first (by createdAt). */
  listQuotes(): Quote[] {
    return (
      this.db
        .prepare("SELECT * FROM quotes ORDER BY createdAt DESC")
        .all() as QuoteRow[]
    ).map(rowToQuote);
  }

  getQuote(id: string): Quote | undefined {
    const row = this.db.prepare("SELECT * FROM quotes WHERE id = ?").get(id) as
      | QuoteRow
      | undefined;
    return row ? rowToQuote(row) : undefined;
  }

  /** Persist an approved quote. Assigns a unique q-N id (derived from the DB max,
   *  restart-safe like logActivity) plus createdAt and a default "approved" status. */
  addQuote(
    input: Omit<Quote, "id" | "createdAt" | "status"> & {
      status?: Quote["status"];
    },
  ): Quote {
    const maxRow = this.db
      .prepare(
        "SELECT id FROM quotes WHERE id LIKE 'q%' ORDER BY rowid DESC LIMIT 1",
      )
      .get() as { id: string } | undefined;
    let next = 1;
    if (maxRow) {
      const m = maxRow.id.match(/^q(\d+)$/);
      if (m) next = parseInt(m[1], 10) + 1;
    }
    const quote: Quote = {
      id: `q${next}`,
      accountId: input.accountId,
      accountName: input.accountName,
      lineItems: input.lineItems,
      subtotal: input.subtotal,
      status: input.status ?? "approved",
      createdAt: new Date().toISOString(),
    };
    if (input.useCase != null) quote.useCase = input.useCase;
    if (input.seats != null) quote.seats = input.seats;
    if (input.note != null) quote.note = input.note;
    this.db
      .prepare(
        "INSERT INTO quotes (id, accountId, accountName, useCase, seats, lineItems, subtotal, note, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        quote.id,
        quote.accountId,
        quote.accountName,
        quote.useCase ?? null,
        quote.seats ?? null,
        JSON.stringify(quote.lineItems),
        quote.subtotal,
        quote.note ?? null,
        quote.status,
        quote.createdAt,
      );
    return quote;
  }

  moveStage(dealId: string, stage: Stage): Deal {
    if (!isValidStage(stage)) throw new Error(`invalid stage: ${stage}`);
    const deal = this.getDeal(dealId);
    if (!deal) throw new Error(`deal not found: ${dealId}`);
    let probability = deal.probability;
    if (stage === "Closed Won") probability = 100;
    if (stage === "Closed Lost") probability = 0;
    this.db
      .prepare("UPDATE deals SET stage = ?, probability = ? WHERE id = ?")
      .run(stage, probability, dealId);
    return this.getDeal(dealId)!;
  }

  updateDeal(
    dealId: string,
    fields: Partial<
      Pick<Deal, "amount" | "probability" | "closeDate" | "name">
    >,
  ): Deal {
    const deal = this.getDeal(dealId);
    if (!deal) throw new Error(`deal not found: ${dealId}`);
    // Build a dynamic SET clause for only the fields that are provided.
    const setClauses: string[] = [];
    const values: (string | number)[] = [];
    if (fields.amount !== undefined) {
      setClauses.push("amount = ?");
      values.push(fields.amount);
    }
    if (fields.probability !== undefined) {
      setClauses.push("probability = ?");
      values.push(fields.probability);
    }
    if (fields.closeDate !== undefined) {
      setClauses.push("closeDate = ?");
      values.push(fields.closeDate);
    }
    if (fields.name !== undefined) {
      setClauses.push("name = ?");
      values.push(fields.name);
    }
    if (setClauses.length > 0) {
      values.push(dealId);
      this.db
        .prepare(`UPDATE deals SET ${setClauses.join(", ")} WHERE id = ?`)
        .run(...values);
    }
    return this.getDeal(dealId)!;
  }

  /**
   * Replace a deal's line items and recompute `amount` as Σ(qty × unitPrice).
   * This keeps the seed invariant (`amount === Σ qty×unitPrice`) true for any
   * deal the copilot re-quotes via the apply-to-deal flow.
   */
  setDealLineItems(dealId: string, items: DealLineItem[]): Deal {
    if (!this.getDeal(dealId)) throw new Error(`deal not found: ${dealId}`);
    const amount = items.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);
    this.db
      .prepare("UPDATE deals SET lineItems = ?, amount = ? WHERE id = ?")
      .run(JSON.stringify(items), amount, dealId);
    return this.getDeal(dealId)!;
  }

  markWon(dealId: string): Deal {
    return this.moveStage(dealId, "Closed Won");
  }

  setEnrichment(accountId: string, enrichment: EnrichmentResult): Account {
    const acct = this.getAccount(accountId);
    if (!acct) throw new Error(`account not found: ${accountId}`);
    this.db
      .prepare("UPDATE accounts SET enrichment = ? WHERE id = ?")
      .run(JSON.stringify(enrichment), accountId);
    return this.getAccount(accountId)!;
  }

  logActivity(dealId: string, type: Activity["type"], body: string): Activity {
    if (!this.getDeal(dealId)) throw new Error(`deal not found: ${dealId}`);

    // Derive a restart-safe unique id from the max numeric suffix of existing act-N ids.
    const maxRow = this.db
      .prepare(
        "SELECT id FROM activities WHERE id LIKE 'act-%' ORDER BY rowid DESC LIMIT 1",
      )
      .get() as { id: string } | undefined;
    let next = 1;
    if (maxRow) {
      // act-N ids only; the numeric suffix IS the counter — collision-free and
      // restart-safe because it is derived from the persisted DB max, not the clock.
      const m = maxRow.id.match(/^act-(\d+)$/);
      if (m) next = parseInt(m[1], 10) + 1;
    }
    const id = `act-${next}`;
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO activities (id, dealId, type, body, createdAt) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, dealId, type, body, createdAt);
    const activity: Activity = { id, dealId, type, body, createdAt };
    return activity;
  }
}

/** Process-global singleton. The AG-UI bridge clones the *agent* per thread,
 *  so CRM state must live module-level to stay shared across threads. */
export const crm = new CrmStore();
