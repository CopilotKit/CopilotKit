import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PriceSheetInput } from "./price-sheet-pdf";
import { FRESH_STYLES } from "./price-sheet-styles";
import { SEED_PRODUCTS } from "./seed";
import * as store from "./store";

/**
 * The beat-3d document route.
 *
 * These assertions exist because the failure they pin is INVISIBLE end to end.
 * `GET /api/commerce/v1/price-sheet` used to be the one commerce route with no
 * `try`/`catch`, so a throw from `buildPriceSheetPdf` left no record of its own
 * and produced whatever Next emits for an uncaught handler error. Downstream,
 * `stagePriceSheetAttachment` maps any non-2xx to `staged === false`, and
 * `sendRestockRequestWithPriceSheet` sends the pill's prompt regardless — so the
 * model is told "here's the autumn price sheet, read it" with nothing attached
 * and answers from the catalog it can already see. On stage that reads as a
 * working demo; it proves the opposite of what the beat exists to prove.
 *
 * So the contract under test is narrow and behavioural: a throwing PDF writer
 * must produce a non-2xx the consumer can distinguish from a PDF, AND a server
 * log carrying enough context to identify the request.
 */

// Hoisted so the `vi.mock` factory below (which is itself hoisted above the
// imports) can close over the spy.
const { pdfSpy } = vi.hoisted(() => ({
  // Typed with the writer's own signature, so `pdfSpy.mock.calls` reads as
  // `PriceSheetInput` and the row assertions below need no cast.
  pdfSpy: vi.fn<(input: PriceSheetInput) => Uint8Array>(),
}));

vi.mock("@/skins/commerce/data/price-sheet-pdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./price-sheet-pdf")>()),
  buildPriceSheetPdf: pdfSpy,
}));

const { GET } = await import("@/app/api/commerce/v1/price-sheet/route");
const realPdf =
  await vi.importActual<typeof import("./price-sheet-pdf")>(
    "./price-sheet-pdf",
  );

const request = (url = "http://localhost/api/commerce/v1/price-sheet") =>
  new Request(url);

/** The input the route handed the PDF writer on its most recent call. */
const lastSheet = (): PriceSheetInput => {
  const call = pdfSpy.mock.calls.at(-1);
  if (!call) throw new Error("buildPriceSheetPdf was never called");
  return call[0];
};

describe("GET /api/commerce/v1/price-sheet", () => {
  let log: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, "error").mockImplementation(() => {});
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Default to the real writer, so the happy-path cases exercise the actual
    // PDF bytes and only the failure cases opt into throwing.
    pdfSpy.mockImplementation(realPdf.buildPriceSheetPdf);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    pdfSpy.mockReset();
  });

  it("still serves the generated PDF on the happy path", async () => {
    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toContain(
      "price-sheet-kestrel-mills.pdf",
    );

    // Real PDF bytes, not an error envelope the consumer would hand to the model
    // as if it were a document.
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.byteLength).toBeGreaterThan(0);
    expect(new TextDecoder().decode(body.slice(0, 5))).toBe("%PDF-");
    expect(log).not.toHaveBeenCalled();
  });

  // THE REGRESSION. Before the fix this call rejected out of the handler.
  it("answers a logged 500 when the PDF writer throws", async () => {
    const boom = new Error("pdf writer exploded");
    pdfSpy.mockImplementation(() => {
      throw boom;
    });

    const res = await GET(request());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "INTERNAL_ERROR",
      message: "Something went wrong on our side.",
    });
    expect(log).toHaveBeenCalledWith(
      "[commerce/api] GET price-sheet?vendor=Kestrel Mills",
      boom,
    );
  });

  // A non-2xx is the only thing `stagePriceSheetAttachment` checks, so this is
  // the assertion that the consumer can tell failure from success at all. A 2xx
  // carrying an error envelope would be handed to the model as a "PDF".
  it("never answers a 2xx when the PDF writer throws", async () => {
    pdfSpy.mockImplementation(() => {
      throw new Error("pdf writer exploded");
    });

    const res = await GET(request());

    expect(res.ok).toBe(false);
    expect(res.headers.get("content-type")).not.toContain("application/pdf");
  });

  // A non-Error throw must not slip through as a success either — `errorResponse`
  // reads `error.message`, which does not exist here.
  it("answers a logged 500 when the PDF writer throws a non-Error", async () => {
    pdfSpy.mockImplementation(() => {
      throw "not an error at all";
    });

    const res = await GET(request());

    expect(res.status).toBe(500);
    expect(log).toHaveBeenCalledTimes(1);
  });

  // The log line has to distinguish one failing request from another, otherwise
  // it cannot answer "which price sheet failed?" — the whole point of logging it.
  it("names the requested vendor in the log line", async () => {
    pdfSpy.mockImplementation(() => {
      throw new Error("pdf writer exploded");
    });

    // A vendor that exists in the seed, so the 404 above does not short-circuit
    // before the writer runs.
    const vendor = "Kestrel Mills";
    await GET(
      request(
        `http://localhost/api/commerce/v1/price-sheet?vendor=${encodeURIComponent(vendor)}`,
      ),
    );

    expect(log).toHaveBeenCalledWith(
      `[commerce/api] GET price-sheet?vendor=${vendor}`,
      expect.any(Error),
    );
  });

  // The vendor-miss 404 is a deliberate domain answer and must NOT be reclassified
  // as an internal error by the new catch, nor logged as one.
  it("leaves the vendor-miss 404 alone", async () => {
    const res = await GET(
      request(
        "http://localhost/api/commerce/v1/price-sheet?vendor=Nobody%20Mills",
      ),
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "NOT_FOUND" });
    expect(log).not.toHaveBeenCalled();
  });

  /**
   * The vendor miss has to leave a SERVER-side record.
   *
   * A seed vendor rename is the failure this exists for: the pill fetches this
   * route with no `vendor`, so the route's default stops matching every product,
   * the sheet 404s, and beat 3d's attachment quietly stops existing. The consumer
   * chain does alert the presenter — but it can only say "HTTP 404, see the server
   * logs", and nothing was ever written there.
   */
  describe("the vendor-miss log", () => {
    // A `console.warn`, not a `console.error`: this is a deliberate domain answer,
    // and `errorResponse` owns the error channel for genuine faults. The 404 test
    // above pins the other half — that it is still not an error.
    it("warns, naming the requested vendor", async () => {
      await GET(
        request(
          "http://localhost/api/commerce/v1/price-sheet?vendor=Nobody%20Mills",
        ),
      );

      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0]?.[0]);
      expect(line).toContain("[commerce/api]");
      expect(line).toContain("price-sheet?vendor=Nobody Mills");
    });

    // "Which vendors ARE stocked?" is the next question a reader of that line has,
    // and it is what turns a rename from a mystery into a one-line diagnosis.
    it("names the vendors that are stocked", async () => {
      await GET(
        request(
          "http://localhost/api/commerce/v1/price-sheet?vendor=Nobody%20Mills",
        ),
      );

      const line = String(warn.mock.calls[0]?.[0]);
      for (const vendor of new Set(SEED_PRODUCTS.map((p) => p.vendor))) {
        expect(line).toContain(vendor);
      }
    });

    /**
     * THE RENAME SCENARIO ITSELF, which is the only way the DEFAULT vendor misses:
     * the pill sends no `vendor` at all, so a reseed that renames Kestrel Mills
     * turns beat 3d's own request into a miss. The line has to name the RESOLVED
     * default rather than the raw empty string, or it says nothing about which
     * sheet failed — the same rule the catch's log line follows.
     */
    it("names the resolved default when an empty vendor misses", async () => {
      vi.spyOn(store, "products").mockReturnValue([]);

      await GET(
        request("http://localhost/api/commerce/v1/price-sheet?vendor="),
      );

      expect(String(warn.mock.calls[0]?.[0])).toContain(
        "price-sheet?vendor=Kestrel Mills",
      );
      // Nothing is stocked at all, so the line says so rather than trailing off.
      expect(String(warn.mock.calls[0]?.[0])).toContain("(none)");
    });

    // A served sheet must stay quiet, or the log stops meaning anything.
    it("stays silent on the happy path", async () => {
      await GET(request());

      expect(warn).not.toHaveBeenCalled();
    });
  });

  /**
   * EVERY ROW BELONGS TO THE VENDOR REQUESTED.
   *
   * THE REGRESSION. The route used to push one hard-coded row — "BW-ALD-CRW /
   * Alder Crewneck" — onto every sheet, so `?vendor=Ardent%20Leather` returned a
   * leather-goods supplier's sheet quoting a knit crewneck. This document is beat
   * 3d's ingested artifact: the model lifts its rows out and narrates them as
   * fact, so a row from the wrong vendor makes the assistant assert a supplier
   * relationship that does not exist.
   *
   * Read from the writer's INPUT rather than from the rendered bytes: the rows are
   * what the assertion is about, and the PDF is a rendering of them.
   */
  describe("row provenance", () => {
    const vendors = [...new Set(SEED_PRODUCTS.map((p) => p.vendor))].sort();

    const sheetFor = async (vendor: string) => {
      const res = await GET(
        request(
          `http://localhost/api/commerce/v1/price-sheet?vendor=${encodeURIComponent(vendor)}`,
        ),
      );
      expect(res.status).toBe(200);
      return lastSheet();
    };

    it.each(vendors)("quotes %s only its own styles", async (vendor) => {
      const sheet = await sheetFor(vendor);
      const own = new Set(
        SEED_PRODUCTS.filter((p) => p.vendor === vendor).map((p) => p.sku),
      );
      const fresh = FRESH_STYLES.get(vendor);

      expect(sheet.vendor).toBe(vendor);
      expect(sheet.lines.length).toBeGreaterThan(0);
      for (const line of sheet.lines) {
        // Either a style this vendor carries, or this vendor's own fresh style.
        // Nothing else may appear on the page.
        expect(own.has(line.sku) || line.sku === fresh?.sku).toBe(true);
      }
    });

    // Stated the other way round, so the assertion fails on the exact shape of the
    // original defect: another vendor's fresh style leaking onto this sheet.
    it.each(vendors)(
      "never quotes %s another vendor's style",
      async (vendor) => {
        const sheet = await sheetFor(vendor);
        const foreign = new Set([
          ...SEED_PRODUCTS.filter((p) => p.vendor !== vendor).map((p) => p.sku),
          ...[...FRESH_STYLES.entries()]
            .filter(([name]) => name !== vendor)
            .map(([, fresh]) => fresh.sku),
        ]);

        for (const line of sheet.lines) {
          expect(foreign.has(line.sku)).toBe(false);
        }
      },
    );

    // The named case from the report, spelled out: a leather-goods vendor and a
    // knit crewneck.
    it("does not quote Ardent Leather the Alder Crewneck", async () => {
      const sheet = await sheetFor("Ardent Leather");

      expect(sheet.lines.map((l) => l.sku)).not.toContain("BW-ALD-CRW");
      expect(sheet.lines.map((l) => l.name)).not.toContain("Alder Crewneck");
      expect(sheet.lines.map((l) => l.sku)).toContain("BW-SDL-WLT");
    });

    // Beat 3d's hook has to survive the fix: exactly one row the catalog cannot
    // supply, and it is the one with no current cost to compare against.
    it.each(vendors)(
      "gives %s exactly one first-time style",
      async (vendor) => {
        const sheet = await sheetFor(vendor);
        const catalogSkus = new Set(SEED_PRODUCTS.map((p) => p.sku));
        const first = sheet.lines.filter((l) => !catalogSkus.has(l.sku));

        expect(first).toHaveLength(1);
        expect(first[0]?.currentCost).toBeUndefined();
        expect(first[0]?.sku).toBe(FRESH_STYLES.get(vendor)?.sku);
      },
    );

    // And the carried rows keep their current cost, which is what the document's
    // derived "Cost movement" section compares the quote against.
    it("keeps the current cost on every carried row", async () => {
      const sheet = await sheetFor("Kestrel Mills");
      const carried = sheet.lines.filter((l) => l.sku !== "BW-ALD-CRW");

      expect(carried.length).toBeGreaterThan(0);
      for (const line of carried) {
        const seeded = SEED_PRODUCTS.find((p) => p.sku === line.sku);
        expect(line.currentCost).toBe(seeded?.unitCost);
      }
    });
  });

  /**
   * The `vendor` lever, absent vs present-but-unusable.
   *
   * `?vendor=` used to read as the empty string, which is not nullish, so the
   * `??` default never applied: the filter matched no seeded product and the
   * route 404'd on a vendor nobody named. Downstream that is beat 3d's silent
   * failure again — `stagePriceSheetAttachment` sees a non-2xx, returns `false`,
   * and the prompt is sent with no document attached.
   *
   * The rule under test is the orders page's lever rule (`parseTopLever` in
   * `pages/orders.tsx`): trim, then IGNORE a value that cannot be used rather
   * than failing the request on it. So an unusable `vendor` is the same request
   * as no `vendor` at all, and a genuinely-named unknown vendor still 404s.
   */
  describe("the vendor lever", () => {
    const priceSheet = (query: string) =>
      GET(request(`http://localhost/api/commerce/v1/price-sheet${query}`));

    // The reference answer every unusable value has to match, byte for byte.
    const servesTheDefaultSheet = async (res: Response) => {
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("content-disposition")).toContain(
        "price-sheet-kestrel-mills.pdf",
      );
      expect(log).not.toHaveBeenCalled();
    };

    // THE REGRESSION. `?vendor=` is what a cleared field or a
    // `URLSearchParams.set("vendor", "")` produces; before the fix it 404'd.
    it("treats an empty vendor as an absent one", async () => {
      await servesTheDefaultSheet(await priceSheet("?vendor="));
    });

    // Whitespace-only is unusable for the same reason and must not be a 404
    // either — `%20` and `+` are both a single space in a query string.
    it.each(["?vendor=%20", "?vendor=+", "?vendor=%20%20%09"])(
      "treats a whitespace-only vendor as an absent one (%s)",
      async (query) => {
        await servesTheDefaultSheet(await priceSheet(query));
      },
    );

    // The trim is not only a guard: surrounding space on a REAL name resolves
    // rather than 404ing, which is the same trim the top lever applies.
    it("trims surrounding whitespace off a real vendor", async () => {
      const res = await priceSheet("?vendor=%20Halden%20Home%20");

      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain(
        "price-sheet-halden-home.pdf",
      );
      expect(log).not.toHaveBeenCalled();
    });

    // A real, exactly-named vendor other than the default is unchanged.
    it("still serves a named vendor's own sheet", async () => {
      const res = await priceSheet("?vendor=Halden%20Home");

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("content-disposition")).toContain(
        "price-sheet-halden-home.pdf",
      );
    });

    // And a vendor the caller genuinely named but the seed does not stock is
    // still a 404 — the fallback must not swallow a real miss into the default.
    it("still 404s a genuinely unknown vendor", async () => {
      const res = await priceSheet("?vendor=%20Nobody%20Mills%20");

      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toMatchObject({ error: "NOT_FOUND" });
    });

    // The hoisted `vendor` is the log line's only request-varying input, so the
    // resolved default — not the raw empty string — has to be what it names.
    it("names the resolved default in the log line for an empty vendor", async () => {
      pdfSpy.mockImplementation(() => {
        throw new Error("pdf writer exploded");
      });

      await priceSheet("?vendor=");

      expect(log).toHaveBeenCalledWith(
        "[commerce/api] GET price-sheet?vendor=Kestrel Mills",
        expect.any(Error),
      );
    });
  });
});
