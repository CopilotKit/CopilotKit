import { describe, expect, it } from "vitest";
import { FRESH_STYLES, freshStyleFor } from "./price-sheet-styles";
import { SEED_PRODUCTS } from "./seed";
import type { Category } from "./types";

/**
 * BEAT 3d — the fresh row's provenance.
 *
 * The regression these pin: the price-sheet route pushed ONE hard-coded row
 * ("BW-ALD-CRW / Alder Crewneck") onto every sheet, whatever vendor was asked
 * for, so `?vendor=Ardent%20Leather` produced a leather-goods supplier quoting a
 * knit crewneck. The document is beat 3d's ingested artifact — the model lifts
 * facts out of it and narrates them — so a row from the wrong vendor is the app
 * asserting a supplier relationship that does not exist.
 *
 * These assertions are about the TABLE's invariants. `price-sheet-route.test.ts`
 * asserts the rows the route actually emits.
 */

const vendorsInSeed = [...new Set(SEED_PRODUCTS.map((p) => p.vendor))].sort();

const categoriesOf = (vendor: string) =>
  new Set(
    SEED_PRODUCTS.filter((p) => p.vendor === vendor).map((p) => p.category),
  );

describe("FRESH_STYLES", () => {
  // Every seeded vendor needs an entry, or its sheet loses the row that proves
  // the document was read. Adding a vendor to the seed turns this red.
  it.each(vendorsInSeed)("has an entry for %s", (vendor) => {
    expect(FRESH_STYLES.get(vendor)).toBeDefined();
  });

  // THE REGRESSION, at the table level: a vendor may only be quoted a style in a
  // category it genuinely supplies.
  it.each(vendorsInSeed)(
    "quotes %s a style in a category it actually supplies",
    (vendor) => {
      const fresh = FRESH_STYLES.get(vendor);
      expect(fresh).toBeDefined();
      expect([...categoriesOf(vendor)]).toContain(fresh?.category);
    },
  );

  // A fresh SKU that collides with a seeded one reads as a style the catalog
  // already carries, which defeats the point of the row.
  it("never reuses a seeded SKU or style name", () => {
    const seededSkus = new Set(SEED_PRODUCTS.map((p) => p.sku));
    const seededNames = new Set(SEED_PRODUCTS.map((p) => p.name));

    for (const fresh of FRESH_STYLES.values()) {
      expect(seededSkus.has(fresh.sku)).toBe(false);
      expect(seededNames.has(fresh.name)).toBe(false);
    }
  });

  // The shape of the original defect: one row shared by every vendor. Distinct
  // SKUs and names per vendor is what makes each sheet that vendor's own.
  it("gives every vendor its own SKU and style name", () => {
    const skus = [...FRESH_STYLES.values()].map((f) => f.sku);
    const names = [...FRESH_STYLES.values()].map((f) => f.name);

    expect(new Set(skus).size).toBe(skus.length);
    expect(new Set(names).size).toBe(names.length);
  });

  // Quote figures, not catalog facts — but a nonsense figure would be narrated as
  // a real quote, so they have to be usable money.
  it("quotes a positive cost and a positive minimum for every vendor", () => {
    for (const fresh of FRESH_STYLES.values()) {
      expect(fresh.quotedCost).toBeGreaterThan(0);
      expect(fresh.minimumUnits).toBeGreaterThan(0);
    }
  });
});

describe("freshStyleFor", () => {
  const rows = (...categories: Category[]) =>
    categories.map((category) => ({ category }));

  it("returns the vendor's style when the vendor supplies that category", () => {
    expect(freshStyleFor("Kestrel Mills", rows("Knitwear"))?.sku).toBe(
      "BW-ALD-CRW",
    );
  });

  // The live-catalog check, which is what makes a reseed drop the row rather than
  // misattribute it: the table says Knitwear, the vendor's rows say otherwise.
  it("drops the row when the vendor no longer supplies that category", () => {
    expect(
      freshStyleFor("Kestrel Mills", rows("Home", "Footwear")),
    ).toBeUndefined();
  });

  it("returns nothing for a vendor with no entry", () => {
    expect(freshStyleFor("Nobody Mills", rows("Knitwear"))).toBeUndefined();
  });

  // A `Map` rather than a plain object: `vendor` is a caller-supplied query
  // string, and a prototype hit would put a garbage row on the sheet.
  it.each(["constructor", "toString", "__proto__", "valueOf"])(
    "does not resolve %s off the prototype chain",
    (vendor) => {
      expect(freshStyleFor(vendor, rows("Knitwear"))).toBeUndefined();
    },
  );
});
