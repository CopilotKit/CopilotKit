import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "./route";
import * as store from "@/skins/exec/data/store";
import { toAscii } from "@/shell/documents";
import { seedInitiatives } from "@/skins/exec/data/seed";

beforeEach(() => store.reset());

const call = () => GET();

/**
 * The PDF's content stream is plain (uncompressed) text, so the document can
 * be read back as bytes. Folded through the SAME ASCII fold the writer
 * applies, so a figure containing a typographic character is compared
 * against what was actually drawn.
 */
const textOf = async (res: Response) =>
  Buffer.from(await res.arrayBuffer()).toString("latin1");

const liveBreach = () =>
  store
    .exceptions()
    .find((e) => e.metricId === "opex" && e.department === "distribution")!;

const livePoint = () =>
  store
    .metricSeries({ metricId: "opex", department: "distribution", months: 1 })
    .find((p) => p.period === liveBreach().period)!;

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

describe("GET /budget-memo serves the document beat 3d ingests", () => {
  it("returns a PDF that is never cached, under the name the composer chip prints", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toBe(
      'inline; filename="Cascade-Distribution-budget-memo.pdf"',
    );
  });

  it("prints the same period and figures the live ledger holds after a reset", async () => {
    const point = livePoint();
    const text = await textOf(await call());
    expect(text).toContain(toAscii(CURRENCY.format(point.actual)));
    expect(text).toContain(toAscii(CURRENCY.format(point.plan)));
    expect(text).toContain(toAscii(CURRENCY.format(point.actual - point.plan)));
  });

  it("splits the live overrun into two drivers that sum back to it exactly", async () => {
    const point = livePoint();
    const overrun = Math.round(point.actual - point.plan);
    const text = await textOf(await call());
    const amounts = [...text.matchAll(/\$[\d,]+/g)].map((m) =>
      Number(m[0].replace(/[$,]/g, "")),
    );
    // Document order: actual, plan, overrun (Summary), then the two drivers.
    expect(amounts.slice(0, 3)).toEqual([
      Math.round(point.actual),
      Math.round(point.plan),
      overrun,
    ]);
    const [timingUsd, oneOffUsd] = amounts.slice(3);
    expect(timingUsd + oneOffUsd).toBe(overrun);
    // Timing is always the larger driver — the only cue that lets the reader
    // infer VAR-TIMING, since the memo never prints a narrative code.
    expect(timingUsd).toBeGreaterThan(oneOffUsd);
  });

  it("still serves once a narrative has been filed for that breach", async () => {
    // `explained` must NOT gate this route — the memo is the source a
    // narrative is filed FROM, and a re-attach after filing (a presenter
    // retry, or the agent re-reading its own cited source) must not 404.
    const { period } = liveBreach();
    store.fileNarrative({
      metricId: "opex",
      period,
      code: "VAR-TIMING",
      body: "Filed from the memo.",
      source: "typed",
    });
    expect(
      store.exceptions().find((e) => e.metricId === "opex")?.explained,
    ).toBe(true);
    expect((await call()).status).toBe(200);
  });
});

describe("what the memo must NOT say", () => {
  it("prints no narrative code, filedAt timestamp, or explained status", async () => {
    const text = await textOf(await call());
    expect(text).not.toMatch(/VAR-(TIMING|ONEOFF|FX|PLAN)/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(text).not.toContain("explained");
  });
});

describe("the memo date survives a DST fallback between close and issue", () => {
  const ORIGINAL_TZ = process.env.TZ;

  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
    vi.restoreAllMocks();
  });

  /**
   * America/New_York falls back off DST at 2am on 1 November 2026, i.e.
   * squarely inside the 5-day window between a "2026-10" close (31 October)
   * and the memo's dateline. Adding `5 * 86_400_000` ms to a local-midnight
   * `Date` crosses that fallback and LANDS A CALENDAR DAY SHORT: 4 November
   * instead of 5 November. The route must compute the dateline in calendar
   * days, not milliseconds.
   *
   * The route's date formatters are module-scope `Intl.DateTimeFormat`
   * instances, which resolve the host timezone once, AT CONSTRUCTION —
   * setting `process.env.TZ` after the module has already loaded does
   * nothing to them. So the module is reloaded fresh, under the target TZ,
   * via `vi.resetModules()` + a dynamic import, rather than reusing the
   * `route`/`store` bindings the rest of this file imported at parse time.
   */
  it("dates the memo 5 November, not 4 November, for a period closing 31 October", async () => {
    process.env.TZ = "America/New_York";
    vi.resetModules();

    const freshStore = await import("@/skins/exec/data/store");
    const point = {
      metricId: "opex" as const,
      period: "2026-10",
      department: "distribution" as const,
      plan: 216_000,
      actual: 235_440,
      forecast: 216_000,
    };
    vi.spyOn(freshStore, "exceptions").mockReturnValue([
      {
        metricId: "opex",
        period: "2026-10",
        department: "distribution",
        variancePct: freshStore.variancePct(point),
        explained: false,
      },
    ]);
    vi.spyOn(freshStore, "metricSeries").mockReturnValue([point]);
    const { GET: freshGet } = await import("./route");

    const text = await textOf(await freshGet());
    expect(text).toContain("5 November 2026");
    expect(text).not.toContain("4 November 2026");
  });
});

describe("the memo only ever narrates an over-plan breach", () => {
  afterEach(() => vi.restoreAllMocks());

  /**
   * The memo's prose is written for an overrun ("closed at X against a plan
   * of Y, an overrun of Z... over plan") — it has no sentence for the
   * opposite case. `isBreach` trips on MAGNITUDE, so an under-plan breach
   * (actual comfortably below plan, but by more than the threshold) is a
   * value `exceptions()` can legitimately return. Rather than print
   * "an overrun of -$19,440", the route must recognize it cannot narrate
   * this breach honestly and 404, the same way it 404s when there is no
   * breach at all.
   */
  it("404s instead of printing a negative overrun as a positive one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const point = {
      metricId: "opex" as const,
      period: "2026-10",
      department: "distribution" as const,
      plan: 216_000,
      actual: 196_000, // under plan, but past the 5% threshold
      forecast: 216_000,
    };
    vi.spyOn(store, "exceptions").mockReturnValue([
      {
        metricId: "opex",
        period: "2026-10",
        department: "distribution",
        variancePct: store.variancePct(point),
        explained: false,
      },
    ]);
    vi.spyOn(store, "metricSeries").mockReturnValue([point]);

    const res = await call();

    expect(res.status).toBe(404);
    expect(warn).toHaveBeenCalled();
  });
});

describe("the memo's author matches the seed's initiative owner", () => {
  /**
   * The memo names an author distinct from anyone in `seedInitiatives()`
   * reads, on stage, as an error rather than two coincidentally similar
   * names — especially since the Distribution-automation initiative note
   * (`seed.ts`) explicitly ties itself to this same opex overrun. Pin the
   * memo's author to that initiative's owner rather than a hardcoded
   * literal, so the two can never drift apart again.
   */
  it("prints the Distribution-automation initiative's owner as the author", async () => {
    const owner = seedInitiatives().find(
      (i) => i.id === "init-distribution-automation",
    )!.owner;

    const text = await textOf(await call());
    expect(text).toContain(owner);
  });
});
