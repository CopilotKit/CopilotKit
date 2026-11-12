import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { seed } from "./seed.js";

/**
 * Opens a DatabaseSync instance.
 * - Default file: `data/northstar.db` resolved relative to this module (not cwd).
 * - Pass `":memory:"` for in-memory (e.g. tests).
 * - Enables foreign key enforcement.
 */
export function openDb(filename?: string): DatabaseSync {
  const path = filename ?? process.env.NORTHSTAR_DB_PATH ?? defaultDbPath();
  if (path !== ":memory:") {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

/**
 * Creates all tables (if they don't already exist).
 *
 * JSON-encoded columns follow the `accounts.enrichment` precedent: stored as a
 * TEXT column and `JSON.parse`d on read. New here: `deals.lineItems`,
 * `reports.metrics`, and `reports.highlights`.
 */
export function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      domain        TEXT NOT NULL,
      industry      TEXT,
      sizeEmployees INTEGER,
      location      TEXT,
      enrichment    TEXT
    );
    CREATE TABLE IF NOT EXISTS contacts (
      id        TEXT PRIMARY KEY,
      accountId TEXT NOT NULL REFERENCES accounts(id),
      name      TEXT NOT NULL,
      title     TEXT NOT NULL,
      email     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deals (
      id          TEXT PRIMARY KEY,
      accountId   TEXT NOT NULL REFERENCES accounts(id),
      name        TEXT NOT NULL,
      amount      INTEGER NOT NULL,
      stage       TEXT NOT NULL,
      probability INTEGER NOT NULL,
      closeDate   TEXT NOT NULL,
      ownerName   TEXT NOT NULL,
      ownerId     TEXT NOT NULL DEFAULT '',
      lineItems   TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS activities (
      id        TEXT PRIMARY KEY,
      dealId    TEXT NOT NULL REFERENCES deals(id),
      type      TEXT NOT NULL,
      body      TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id        TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      category  TEXT NOT NULL,
      sku       TEXT NOT NULL,
      unitPrice INTEGER NOT NULL,
      photoUrl  TEXT NOT NULL,
      specs     TEXT NOT NULL,
      blurb     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS salespeople (
      id        TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      email     TEXT NOT NULL,
      avatarUrl TEXT NOT NULL,
      role      TEXT NOT NULL,
      region    TEXT NOT NULL,
      quota     INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      periodStart TEXT NOT NULL,
      periodEnd   TEXT NOT NULL,
      generatedAt TEXT NOT NULL,
      summary     TEXT NOT NULL,
      metrics     TEXT NOT NULL,
      highlights  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quotes (
      id          TEXT PRIMARY KEY,
      accountId   TEXT NOT NULL,
      accountName TEXT NOT NULL,
      useCase     TEXT,
      seats       INTEGER,
      lineItems   TEXT NOT NULL DEFAULT '[]',
      subtotal    INTEGER NOT NULL DEFAULT 0,
      note        TEXT,
      status      TEXT NOT NULL DEFAULT 'approved',
      createdAt   TEXT NOT NULL
    );
  `);
}

/**
 * Seeds the database from seed.ts if the accounts table is empty.
 * Idempotent: safe to call multiple times.
 */
export function seedIfEmpty(db: DatabaseSync): void {
  const row = db.prepare("SELECT count(*) AS count FROM accounts").get() as {
    count: number;
  };
  if (row.count > 0) return;

  const data = seed();

  db.exec("BEGIN");
  try {
    const insertAccount = db.prepare(
      "INSERT INTO accounts (id, name, domain, industry, sizeEmployees, location, enrichment) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const a of data.accounts) {
      insertAccount.run(
        a.id,
        a.name,
        a.domain,
        a.industry ?? null,
        a.sizeEmployees ?? null,
        a.location ?? null,
        a.enrichment != null ? JSON.stringify(a.enrichment) : null,
      );
    }

    const insertContact = db.prepare(
      "INSERT INTO contacts (id, accountId, name, title, email) VALUES (?, ?, ?, ?, ?)",
    );
    for (const c of data.contacts) {
      insertContact.run(c.id, c.accountId, c.name, c.title, c.email);
    }

    const insertProduct = db.prepare(
      "INSERT INTO products (id, name, category, sku, unitPrice, photoUrl, specs, blurb) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const p of data.products) {
      insertProduct.run(
        p.id,
        p.name,
        p.category,
        p.sku,
        p.unitPrice,
        p.photoUrl,
        p.specs,
        p.blurb,
      );
    }

    const insertSalesperson = db.prepare(
      "INSERT INTO salespeople (id, name, email, avatarUrl, role, region, quota) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const s of data.salespeople) {
      insertSalesperson.run(
        s.id,
        s.name,
        s.email,
        s.avatarUrl,
        s.role,
        s.region,
        s.quota,
      );
    }

    const insertDeal = db.prepare(
      "INSERT INTO deals (id, accountId, name, amount, stage, probability, closeDate, ownerName, ownerId, lineItems) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const d of data.deals) {
      insertDeal.run(
        d.id,
        d.accountId,
        d.name,
        d.amount,
        d.stage,
        d.probability,
        d.closeDate,
        d.ownerName,
        d.ownerId,
        JSON.stringify(d.lineItems),
      );
    }

    const insertActivity = db.prepare(
      "INSERT INTO activities (id, dealId, type, body, createdAt) VALUES (?, ?, ?, ?, ?)",
    );
    for (const act of data.activities) {
      insertActivity.run(act.id, act.dealId, act.type, act.body, act.createdAt);
    }

    const insertReport = db.prepare(
      "INSERT INTO reports (id, title, periodStart, periodEnd, generatedAt, summary, metrics, highlights) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const r of data.reports) {
      insertReport.run(
        r.id,
        r.title,
        r.periodStart,
        r.periodEnd,
        r.generatedAt,
        r.summary,
        JSON.stringify(r.metrics),
        JSON.stringify(r.highlights),
      );
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Convenience: open → schema → seed → return.
 */
export function initDb(filename?: string): DatabaseSync {
  const db = openDb(filename);
  initSchema(db);
  seedIfEmpty(db);
  return db;
}

function defaultDbPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return join(dirname(thisFile), "..", "..", "data", "northstar.db");
}
