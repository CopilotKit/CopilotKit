/**
 * BEAT 3d — the ONE row of the vendor price sheet that cannot come from the
 * catalog, per vendor.
 *
 * The fresh row is the beat's proof of reading: a style the app has never carried,
 * so an agent that names its quoted cost demonstrably read the attachment rather
 * than answering from the catalog it can already see.
 *
 * WHY IT IS KEYED BY VENDOR. The route used to push ONE hard-coded row —
 * "BW-ALD-CRW / Alder Crewneck" — onto every sheet it generated, so
 * `?vendor=Ardent%20Leather` returned a leather-goods supplier's sheet quoting a
 * knit crewneck. That is not a cosmetic mismatch: this document is the one the
 * model lifts facts OUT of and narrates as fact, so the sheet was manufacturing a
 * supplier relationship that does not exist and the agent would assert it on
 * stage.
 *
 * So each entry names a style in a category that vendor genuinely supplies, and
 * `freshStyleFor` re-checks `category` against the LIVE catalog rows before the
 * row is emitted. Two consequences worth keeping:
 *
 *   - A reseed that moves a vendor out of a category DROPS its fresh row rather
 *     than misattributing it. The document is then that vendor's carried styles
 *     alone, and `costMovementLines` simply omits its "quoted for the first time"
 *     clause — coherent, just a weaker hook for that vendor. Losing a beat's hook
 *     for one vendor is recoverable; a false claim about a supplier is not.
 *   - A vendor with NO entry (one a future reseed adds) gets no fresh row at all,
 *     for the same reason. Add an entry here when you add a vendor —
 *     `price-sheet-styles.test.ts` fails until you do.
 *
 * The SKUs use the app's own "BW-" namespace and must NOT collide with a seeded
 * SKU or name: a colliding code would read as a style the catalog already
 * carries, which defeats the whole point of the row. Pinned by the test file.
 *
 * `quotedCost` and `minimumUnits` are the QUOTE's own figures rather than catalog
 * facts, which is why they are stated here rather than derived; keep each in the
 * ballpark of that vendor's seeded costs so the sheet reads like a real quote from
 * that supplier.
 *
 * Server-safe: plain TS, no React, no "use client" — it is imported by a route.
 */

import type { Category } from "./types";

export interface FreshStyle {
  sku: string;
  name: string;
  /** Must be a category the vendor actually supplies, or the row is dropped. */
  category: Category;
  quotedCost: number;
  minimumUnits: number;
}

/**
 * A `Map` rather than a plain object for the same reason `CODES` in `http.ts` is
 * one: the key is the caller-supplied `?vendor=` string, and a plain-object lookup
 * walks the prototype chain — `?vendor=constructor` would resolve TRUTHY and put a
 * garbage row on the sheet.
 */
export const FRESH_STYLES: Map<string, FreshStyle> = new Map([
  [
    "Kestrel Mills",
    {
      sku: "BW-ALD-CRW",
      name: "Alder Crewneck",
      category: "Knitwear",
      quotedCost: 52,
      minimumUnits: 900,
    } satisfies FreshStyle,
  ],
  [
    "Northfield Outfitters",
    {
      sku: "BW-RDG-ANK",
      name: "Ridge Anorak",
      category: "Outerwear",
      quotedCost: 185,
      minimumUnits: 400,
    } satisfies FreshStyle,
  ],
  [
    "Vela Footworks",
    {
      sku: "BW-COV-TRL",
      name: "Cove Trail Shoe",
      category: "Footwear",
      quotedCost: 96,
      minimumUnits: 800,
    } satisfies FreshStyle,
  ],
  [
    "Halden Home",
    {
      sku: "BW-BSN-BWL",
      name: "Basin Stoneware Bowl",
      category: "Home",
      quotedCost: 28,
      minimumUnits: 1000,
    } satisfies FreshStyle,
  ],
  [
    "Ardent Leather",
    {
      sku: "BW-SDL-WLT",
      name: "Saddle Card Wallet",
      category: "Accessories",
      quotedCost: 44,
      minimumUnits: 750,
    } satisfies FreshStyle,
  ],
]);

/**
 * The fresh row this vendor may be quoted, or `undefined` when it cannot be
 * asserted.
 *
 * `catalog` is the vendor's OWN live rows (already filtered by the caller), so the
 * category check is against what the vendor supplies right now rather than against
 * the table's own promise about itself.
 */
export const freshStyleFor = (
  vendor: string,
  catalog: readonly { category: Category }[],
): FreshStyle | undefined => {
  const fresh = FRESH_STYLES.get(vendor);
  if (!fresh) return undefined;
  return catalog.some((p) => p.category === fresh.category) ? fresh : undefined;
};
