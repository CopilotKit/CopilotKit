import * as store from "@/skins/commerce/data/store";
import { buildPriceSheetPdf } from "@/skins/commerce/data/price-sheet-pdf";
import type { PriceSheetLine } from "@/skins/commerce/data/price-sheet-pdf";
import { errorResponse } from "@/skins/commerce/data/http";
import { freshStyleFor } from "@/skins/commerce/data/price-sheet-styles";

/**
 * BEAT 3d — serves the vendor price sheet the demo attaches.
 *
 * Generated per request from the live catalog, so the SKUs and the current costs
 * in the document always agree with what the Catalog page shows, and the ship
 * schedule is always a sensible number of weeks out. See `price-sheet-pdf.ts`
 * for why this is not a static file in `public/`.
 *
 * Defaults to Kestrel Mills, the vendor with the most SKUs in the range, so the
 * sheet follows the seed rather than hard-coding a name a future reseed could
 * rename.
 *
 * EVERY ROW IS SCOPED TO THE VENDOR REQUESTED. The model lifts facts out of this
 * document and narrates them, so a row the requested vendor does not supply is
 * the app asserting a supplier relationship that does not exist. The carried rows
 * come from that vendor's own catalog entries, and the one row that cannot (the
 * fresh style beat 3d needs) is per-vendor and category-checked — see
 * `data/price-sheet-styles.ts`.
 */
const DEFAULT_VENDOR = "Kestrel Mills";

/**
 * Resolves the `vendor` lever, treating an absent value and an unusable one as
 * the same request.
 *
 * `searchParams.get("vendor") ?? DEFAULT_VENDOR` was wrong: `??` only falls back
 * on `null`/`undefined`, but `?vendor=` — the shape a cleared field or a
 * `URLSearchParams.set("vendor", "")` produces — yields the EMPTY STRING, which
 * is not nullish. The default never applied, the catalog filter matched nothing,
 * and the route 404'd on a vendor nobody had named. Downstream, `stageAttachment`
 * (`@/shell/attach`) maps the non-2xx to `staged === false`, which now aborts the
 * pill — so the beat does not run at all, and the only clue to WHY is whatever
 * this route left in the log.
 *
 * The fallback (rather than a 400) is the house rule for levers, set by
 * `parseTopLever` in `skins/commerce/pages/orders.tsx`: trim, then IGNORE a
 * value that cannot be used instead of failing the request on it. Trimming is
 * what makes whitespace-only unusable too, and it also lets a stray surrounding
 * space on a REAL vendor name resolve rather than 404. A vendor the caller
 * genuinely named but the seed does not stock is still a miss, and still 404s —
 * this only collapses "said nothing" and "said nothing usable".
 */
const requestedVendor = (url: string): string =>
  new URL(url).searchParams.get("vendor")?.trim() || DEFAULT_VENDOR;

/**
 * Why the WHOLE body is inside the `try`, not just the `buildPriceSheetPdf` call.
 *
 * This route is beat 3d's document source, and it is the ONLY place a failure
 * here can be diagnosed. `stageAttachment` (`@/shell/attach`, reached through
 * `attach-price-sheet.ts`) treats any non-2xx as `staged === false`, and
 * `sendMessageWithAttachment` then ABORTS the pill and alerts the presenter — so
 * the beat fails loudly rather than sending "here's the autumn price sheet, read
 * it" with no file attached. (It did the latter before that chain existed, and
 * still does anywhere the chain is bypassed: the model then answers from the
 * catalog it can already see, the plan is filed, and the demo proves nothing.)
 * But the alert can only say "HTTP 500 — see the server logs", so if this handler
 * leaves no record the presenter is stuck. Without the `catch` below there was no
 * server-side record: an uncaught throw is whatever Next decides to emit, with
 * none of this route's own context in it.
 *
 * Three distinct throw sites live in here, which is why the guard is the whole
 * handler rather than one expression:
 *   1. `new URL(req.url)` / `store.products()` — before any PDF work.
 *   2. `buildPriceSheetPdf` — the PDF writer itself.
 *   3. `new Response(...)` — header validation. `content-disposition` below
 *      interpolates the caller-supplied `vendor`, and a value outside
 *      ISO-8859-1 makes the Response constructor throw. Reachable only for a
 *      vendor that matched a seeded product, but it is a throw site on the
 *      success path, so it belongs under the same guard.
 *
 * `errorResponse` is the same mapper the other eight routes funnel through, so
 * the failure arrives as this skin's structured `{ error, message }` JSON — a
 * shape the consumer can tell from a PDF — and lands in the server log with the
 * `[commerce/api]` prefix.
 */
export const GET = async (req: Request) => {
  // Hoisted out of the `try` only so the `catch` can name the vendor: it is the
  // one request-varying input this route has, and therefore the only thing that
  // distinguishes one failing request from another in the log.
  let vendor = DEFAULT_VENDOR;
  try {
    // Still assigned INSIDE the `try`: `new URL(req.url)` is throw site 1 above,
    // and hoisting the call itself would put that throw outside the guard.
    vendor = requestedVendor(req.url);
    // One snapshot, read twice at most: the vendor's rows, and — only on a miss —
    // the vendor names to name in the log.
    const all = store.products();
    const catalog = all.filter((p) => p.vendor === vendor);

    if (catalog.length === 0) {
      // The miss used to be answered with NOTHING in the server log, which made a
      // seed vendor rename an invisible way to disable beat 3d: the pill fetches
      // this route with no `vendor` at all, so `DEFAULT_VENDOR` above stops
      // matching, the route 404s, and `stageAttachment` maps that to
      // `staged: false`. The consumer chain does name it to the PRESENTER
      // (`reportAttachmentFailure` alerts, and the prompt is not sent), but the
      // alert only says "HTTP 404 — see the server logs", and there was nothing
      // in the server logs to see.
      //
      // `console.warn`, not `console.error`: this is a deliberate domain answer,
      // not a fault, and `errorResponse` owns the `console.error` channel for real
      // faults. Same split as `readJsonBody`'s malformed-body warning in
      // `data/http.ts`.
      //
      // The stocked vendors ride along because the rename is the failure this line
      // exists to diagnose — "who IS stocked?" is the very next question, and
      // answering it in the same line saves the reader a trip to the seed. Safe to
      // be specific: this is a server log, not a response body.
      const stocked = [...new Set(all.map((p) => p.vendor))].sort();
      console.warn(
        `[commerce/api] GET price-sheet?vendor=${vendor} — no SKUs are sourced ` +
          `from that vendor; stocked vendors: ${stocked.join(", ") || "(none)"}`,
      );
      return Response.json(
        {
          error: "NOT_FOUND",
          message: "No SKUs are sourced from that vendor.",
        },
        { status: 404 },
      );
    }

    // Quote a modest increase on two of the vendor's existing SKUs, then — only
    // if this vendor can credibly quote it — one style the app has never seen.
    // The new style is what makes "did it actually read the document?" answerable
    // at a glance: it cannot come from the catalog. See `price-sheet-styles.ts`
    // for why it is per-vendor and conditional rather than a fixed row.
    const carried: PriceSheetLine[] = catalog
      .slice(0, 3)
      .map((item, index) => ({
        sku: item.sku,
        name: item.name,
        currentCost: item.unitCost,
        quotedCost:
          index < 2 ? Math.round(item.unitCost * 1.08) : item.unitCost,
        minimumUnits: index === 0 ? 1200 : 600,
      }));

    const fresh = freshStyleFor(vendor, catalog);
    const lines: PriceSheetLine[] = fresh
      ? [
          ...carried,
          {
            sku: fresh.sku,
            name: fresh.name,
            // Left UNDEFINED rather than 0: the document must not claim a style
            // it has never bought "rose from $0", and `costMovementLines` reads
            // the absence as "quoted for the first time".
            currentCost: undefined,
            quotedCost: fresh.quotedCost,
            minimumUnits: fresh.minimumUnits,
          },
        ]
      : carried;

    const pdf = buildPriceSheetPdf({ vendor, season: "Autumn", lines });

    return new Response(pdf as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="price-sheet-${vendor
          .toLowerCase()
          .replace(/\s+/g, "-")}.pdf"`,
        // Never cache: the ship schedule is computed from `now`, and a cached copy
        // would quietly go stale in exactly the way a static file would.
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, `GET price-sheet?vendor=${vendor}`);
  }
};
