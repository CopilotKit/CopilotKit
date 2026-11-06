import { describe, it, expect } from "vitest";
import { initDb, openDb, initSchema, seedIfEmpty } from "../db.js";

describe("db layer", () => {
  it("initDb(':memory:') seeds known records", () => {
    const db = initDb(":memory:");

    const accounts = db.prepare("SELECT count(*) AS c FROM accounts").get() as {
      c: number;
    };
    const contacts = db.prepare("SELECT count(*) AS c FROM contacts").get() as {
      c: number;
    };
    const deals = db.prepare("SELECT count(*) AS c FROM deals").get() as {
      c: number;
    };
    const activities = db
      .prepare("SELECT count(*) AS c FROM activities")
      .get() as { c: number };

    expect(accounts.c).toBeGreaterThanOrEqual(5);
    expect(contacts.c).toBeGreaterThanOrEqual(5);
    expect(deals.c).toBeGreaterThanOrEqual(6);
    expect(activities.c).toBeGreaterThanOrEqual(3);

    db.close();
  });

  it("seedIfEmpty is idempotent (no duplicate rows on second call)", () => {
    const db = openDb(":memory:");
    initSchema(db);
    seedIfEmpty(db);
    seedIfEmpty(db); // second call must be a no-op

    const row = db.prepare("SELECT count(*) AS c FROM accounts").get() as {
      c: number;
    };
    expect(row.c).toBeGreaterThanOrEqual(5);
    // if rows were duplicated the count would be >= 10
    expect(row.c).toBeLessThan(10);

    db.close();
  });

  it("known seed records are present by id", () => {
    const db = initDb(":memory:");

    const a1 = db.prepare("SELECT id FROM accounts WHERE id = ?").get("a1") as
      | { id: string }
      | undefined;
    expect(a1?.id).toBe("a1");

    const d6 = db.prepare("SELECT id FROM deals WHERE id = ?").get("d6") as
      | { id: string }
      | undefined;
    expect(d6?.id).toBe("d6");

    const ac1 = db
      .prepare("SELECT id FROM activities WHERE id = ?")
      .get("ac1") as { id: string } | undefined;
    expect(ac1?.id).toBe("ac1");

    db.close();
  });

  it("seeds products, salespeople, and reports tables", () => {
    const db = initDb(":memory:");

    const products = db.prepare("SELECT count(*) AS c FROM products").get() as {
      c: number;
    };
    const salespeople = db
      .prepare("SELECT count(*) AS c FROM salespeople")
      .get() as { c: number };
    const reports = db.prepare("SELECT count(*) AS c FROM reports").get() as {
      c: number;
    };

    expect(products.c).toBeGreaterThanOrEqual(10);
    expect(salespeople.c).toBeGreaterThanOrEqual(5);
    expect(reports.c).toBe(1);

    db.close();
  });

  it("deals carry ownerId and a JSON lineItems column", () => {
    const db = initDb(":memory:");
    const d1 = db
      .prepare("SELECT ownerId, lineItems FROM deals WHERE id = ?")
      .get("d1") as { ownerId: string; lineItems: string } | undefined;
    expect(d1).toBeDefined();
    expect(d1!.ownerId.length).toBeGreaterThan(0);
    const items = JSON.parse(d1!.lineItems) as {
      productId: string;
      qty: number;
      unitPrice: number;
    }[];
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    db.close();
  });

  it("report metrics + highlights round-trip through the JSON columns", () => {
    const db = initDb(":memory:");
    const r = db
      .prepare("SELECT metrics, highlights FROM reports WHERE id = ?")
      .get("r1") as { metrics: string; highlights: string } | undefined;
    expect(r).toBeDefined();
    const metrics = JSON.parse(r!.metrics) as { bookings: number };
    const highlights = JSON.parse(r!.highlights) as string[];
    expect(typeof metrics.bookings).toBe("number");
    expect(Array.isArray(highlights)).toBe(true);
    db.close();
  });

  it("foreign key constraint is enforced", () => {
    const db = initDb(":memory:");

    expect(() => {
      db.prepare(
        "INSERT INTO contacts (id, accountId, name, title, email) VALUES (?, ?, ?, ?, ?)",
      ).run("cx", "nonexistent-account", "Test", "Tester", "t@test.com");
    }).toThrow();

    db.close();
  });
});
