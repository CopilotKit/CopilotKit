import { z } from "zod";
import { tool } from "@strands-agents/sdk";
import type { JSONValue } from "@strands-agents/sdk";
import { crm } from "../crm/store.js";
import type { Product, ProductCategory } from "../crm/types.js";

/**
 * recommend_products — build a READ-ONLY draft quote for an account.
 *
 * Resolves the account (by id or fuzzy name), then picks fitting SKUs from the
 * live catalog (`crm.listProducts()`) for the stated use case + seat count and
 * returns a `QuoteCard`-shaped payload. It NEVER mutates the deal store — the
 * apply-to-deal step is a separate HITL flow (`confirm_quote` → setDealLineItems).
 */

interface QuoteLineItem {
  productId: string;
  name: string;
  category: ProductCategory;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  photoUrl: string;
}

interface Quote {
  accountId: string;
  accountName: string;
  useCase: string;
  seats: number;
  lineItems: QuoteLineItem[];
  subtotal: number;
  note: string;
}

/** Cheapest product in a category (deterministic: tie-break on id). */
function cheapestIn(
  products: Product[],
  category: ProductCategory,
): Product | undefined {
  return products
    .filter((p) => p.category === category)
    .sort((a, b) => a.unitPrice - b.unitPrice || a.id.localeCompare(b.id))[0];
}

/** Most capable (priciest) product in a category — for heavier use cases. */
function topIn(
  products: Product[],
  category: ProductCategory,
): Product | undefined {
  return products
    .filter((p) => p.category === category)
    .sort((a, b) => b.unitPrice - a.unitPrice || a.id.localeCompare(b.id))[0];
}

function toLineItem(product: Product, qty: number): QuoteLineItem {
  return {
    productId: product.id,
    name: product.name,
    category: product.category,
    qty,
    unitPrice: product.unitPrice,
    lineTotal: qty * product.unitPrice,
    photoUrl: product.photoUrl,
  };
}

export const recommendProductsTool = tool({
  name: "recommend_products",
  description:
    "Build a draft hardware quote for an account: resolve the account (by id or name), pick fitting products from the catalog for the use case + seat count (laptops + docks/displays for a fleet; workstations/servers for heavier ML/CAD/data-center work), and return a QuoteCard payload (line items with qty, unit price, line total, photo + a subtotal and a one-line rationale). Read-only — applying the quote to a deal is a separate confirm step.",
  inputSchema: z.object({
    accountId: z
      .string()
      .optional()
      .describe("CRM account id (e.g. a6). Preferred when known."),
    name: z
      .string()
      .optional()
      .describe(
        'Account name to fuzzy-match (e.g. "CopilotKit") when no id is given.',
      ),
    seats: z
      .number()
      .min(1)
      .max(5000)
      .optional()
      .describe(
        "Number of seats / users to outfit. Drives laptop quantity for a fleet. Default 25.",
      ),
    useCase: z
      .string()
      .optional()
      .describe(
        'What they need the hardware for (e.g. "sales fleet", "ML workstations", "data center").',
      ),
  }),
  callback: ({ accountId, name, seats, useCase }) => {
    const account = accountId
      ? crm.getAccount(accountId)
      : name
        ? crm.findAccountByName(name)
        : undefined;
    if (!account)
      throw new Error(`account not found: ${accountId ?? name ?? "(none)"}`);

    const products = crm.listProducts();
    const uc = (useCase ?? "").toLowerCase();
    const seatCount = seats ?? 25;

    // Classify the use case into a coarse profile from keywords.
    const heavy =
      /workstation|cad|simulation|render|ml|machine learning|gpu|engineering|data ?cent(er|re)|server|virtuali[sz]ation|compute/.test(
        uc,
      );
    const wantsLaptops =
      !heavy ||
      /laptop|fleet|field|sales|mobile|team|studio|roll ?out|refresh/.test(uc);

    const lineItems: QuoteLineItem[] = [];

    if (wantsLaptops) {
      // Pick the laptop tier by seat scale: large fleets favor the ultraportable
      // Air for cost; smaller teams get the Pro 14 workhorse.
      const laptop =
        seatCount >= 50
          ? cheapestIn(products, "Laptop")
          : (products.find((p) => p.id === "p1") ?? topIn(products, "Laptop"));
      if (laptop) {
        lineItems.push(toLineItem(laptop, seatCount));
        // One dock + one display per seat rounds out a desk-based fleet.
        const dock = cheapestIn(products, "Accessory");
        if (dock) lineItems.push(toLineItem(dock, seatCount));
        const display = cheapestIn(products, "Display");
        if (display) lineItems.push(toLineItem(display, seatCount));
      }
    }

    if (heavy) {
      // Heavier compute: size workstations to the team, add a server for
      // data-center / virtualization language.
      const ws =
        topIn(products, "Workstation") ?? cheapestIn(products, "Workstation");
      if (ws) lineItems.push(toLineItem(ws, Math.max(1, seatCount)));
      if (/server|data ?cent(er|re)|virtuali[sz]ation|rack/.test(uc)) {
        const server = cheapestIn(products, "Server");
        if (server)
          lineItems.push(
            toLineItem(server, Math.max(1, Math.ceil(seatCount / 25))),
          );
      }
    }

    // Fallback: always return at least a laptop-based quote so the card renders.
    if (lineItems.length === 0) {
      const laptop =
        products.find((p) => p.id === "p1") ?? cheapestIn(products, "Laptop");
      if (laptop) lineItems.push(toLineItem(laptop, seatCount));
    }

    const subtotal = lineItems.reduce((sum, li) => sum + li.lineTotal, 0);

    const profile = heavy
      ? wantsLaptops
        ? "mixed fleet + compute"
        : "high-performance compute"
      : "mobile fleet";
    const note = `Recommended a ${profile} for ${account.name} (${seatCount} seat${seatCount === 1 ? "" : "s"}${useCase ? `, ${useCase}` : ""}) — ${lineItems.length} line item${lineItems.length === 1 ? "" : "s"} totaling $${subtotal.toLocaleString("en-US")}.`;

    const quote: Quote = {
      accountId: account.id,
      accountName: account.name,
      useCase: useCase ?? "general",
      seats: seatCount,
      lineItems,
      subtotal,
      note,
    };
    return quote as unknown as JSONValue;
  },
});
