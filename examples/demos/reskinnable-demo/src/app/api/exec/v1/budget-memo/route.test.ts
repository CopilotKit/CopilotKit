import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "./route";
import * as store from "@/skins/exec/data/store";
import { toAscii } from "@/shell/documents";
import { seedInitiatives } from "@/skins/exec/data/seed";

beforeEach(() => store.reset());

/**
 * Captured at module load, BEFORE any test has touched `process.env.TZ` — the
 * residue probe at the bottom of this file compares against it.
 */
const TZ_AT_LOAD = process.env.TZ;

const call = () => GET();

/**
 * The PDF's content stream is plain (uncompressed) text, so the document can
 * be read back as bytes. Folded through the SAME ASCII fold the writer
 * applies, so a figure containing a typographic character is compared
 * against what was actually drawn.
 */
const textOf = async (res: Response) =>
  Buffer.from(await res.arrayBuffer()).toString("latin1");

/**
 * The memo's PROSE, recovered from the content stream: the drawn strings only,
 * with the writer's `\(`/`\)` escapes undone and its word-boundary line wraps
 * re-joined. A sentence the writer split across two `Tj` operators is one
 * string again here, so an assertion can quote the sentence as a reader sees
 * it instead of guessing where the wrap fell.
 */
const proseOf = (pdf: string) =>
  [...pdf.matchAll(/\((.*)\) Tj/g)]
    .map((m) => m[1].replace(/\\([()\\])/g, "$1"))
    .join(" ");

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

const PERCENT = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

/** A point shaped like the live seed's Distribution opex overrun. */
const overrunPoint = (period: string) => ({
  metricId: "opex" as const,
  period,
  department: "distribution" as const,
  plan: 216_000,
  actual: 235_440,
  forecast: 216_000,
});

/** Points the route's two lookups at `point`, bypassing the live seed. */
const stubLedger = (
  target: typeof store,
  point: ReturnType<typeof overrunPoint>,
) => {
  vi.spyOn(target, "exceptions").mockReturnValue([
    {
      metricId: "opex",
      period: point.period,
      department: "distribution",
      variancePct: target.variancePct(point),
      explained: false,
    },
  ]);
  vi.spyOn(target, "metricSeries").mockReturnValue([point]);
};

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
    // The variance the summary sentence quotes is the LIVE breach's, not a
    // figure the memo recomputes for itself.
    expect(proseOf(text)).toContain(
      toAscii(`(${PERCENT.format(liveBreach().variancePct)} over plan)`),
    );
  });

  /**
   * A finance memo cannot be dated after the day it is read. The dateline is
   * period close + 5 days, so on the 1st-4th of any month that lands in the
   * FUTURE — this asserts the live document against the live clock, whatever
   * day the suite happens to run.
   */
  it("never datelines the live memo in the future", async () => {
    const dateline = proseOf(await textOf(await call())).match(
      /Date ([A-Z][a-z]+ \d{1,2}, \d{4})/,
    );
    expect(dateline).not.toBeNull();
    expect(new Date(dateline![1]).getTime()).toBeLessThanOrEqual(Date.now());
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

describe("the route 404s rather than serving a memo it cannot fill in", () => {
  afterEach(() => vi.restoreAllMocks());

  it("404s when there is no live Distribution opex breach at all", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(store, "exceptions").mockReturnValue([]);

    const res = await call();

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "NOT_FOUND" });
    expect(warn).toHaveBeenCalled();
  });

  /**
   * The breach and the point are resolved by two separate store calls, so a
   * reseed that skews their period windows apart leaves a breach whose period
   * has no point. Printing the memo anyway would quote another period's
   * figures under this period's heading; the route must 404 instead.
   */
  it("404s when the breach's period has no point in the series", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(store, "exceptions").mockReturnValue([
      {
        metricId: "opex",
        period: "2026-10",
        department: "distribution",
        variancePct: 0.09,
        explained: false,
      },
    ]);
    // The series holds a DIFFERENT period — `find` by the breach's period
    // comes back undefined.
    vi.spyOn(store, "metricSeries").mockReturnValue([overrunPoint("2026-09")]);

    const res = await call();

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "NOT_FOUND" });
    expect(warn).toHaveBeenCalled();
  });

  /**
   * The whole body is wrapped in a `try` precisely so the attach chain fails
   * LOUDLY with a diagnosable log rather than sending "read the attached
   * memo" with no file attached.
   */
  it("500s and logs when the ledger lookup throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(store, "exceptions").mockImplementation(() => {
      throw new Error("ledger unavailable");
    });

    const res = await call();

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "SERVER_ERROR" });
    expect(error).toHaveBeenCalled();
  });
});

describe("the memo is never datelined in the future", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * Close + 5 days is a dateline that has not happened yet on the 1st-4th of
   * every month: a memo read on 2 September cannot be dated 5 September. The
   * route must clamp the dateline to today.
   */
  it("clamps the dateline to today when close + 5 has not arrived yet", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 2, 9, 30));
    stubLedger(store, overrunPoint("2026-08"));

    const text = await textOf(await call());

    expect(text).toContain("September 2, 2026");
    expect(text).not.toContain("September 5, 2026");
  });

  it("still dates the memo close + 5 once that day has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 20, 9, 30));
    stubLedger(store, overrunPoint("2026-08"));

    expect(await textOf(await call())).toContain("September 5, 2026");
  });
});

describe("the memo date survives a DST fallback between close and issue", () => {
  const ORIGINAL_TZ = process.env.TZ;

  afterEach(() => {
    // `process.env.TZ = undefined` writes the literal STRING "undefined",
    // which Node reads as an invalid zone and silently resolves to UTC — for
    // every test that runs after this one, in this file and anything sharing
    // the environment. An unset variable has to be deleted, not assigned.
    // `process.env.TZ = undefined` writes the literal STRING "undefined",
    // which Node reads as an unrecognized zone and silently resolves to UTC —
    // for every test that runs after this one. An unset variable has to be
    // deleted, not assigned.
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
    vi.useRealTimers();
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
    // Past the dateline, so the clamp to today (see above) is not what is
    // under test here — only the calendar-day arithmetic is.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 20, 9, 30));
    vi.resetModules();

    const freshStore = await import("@/skins/exec/data/store");
    stubLedger(freshStore, overrunPoint("2026-10"));
    const { GET: freshGet } = await import("./route");

    const text = await textOf(await freshGet());
    expect(text).toContain("November 5, 2026");
    expect(text).not.toContain("November 4, 2026");
  });
});

describe("the TZ probe above leaves no residue behind it", () => {
  /**
   * A teardown that assigns `process.env.TZ = ORIGINAL_TZ` when TZ was never
   * set writes the STRING "undefined" into the environment. Node resolves
   * that unrecognized zone to UTC, so every test declared after the probe —
   * here and in any file sharing this environment — silently runs in a
   * different timezone than the one it was written for. This asserts the
   * teardown restored the environment EXACTLY, including the unset case.
   */
  it("leaves process.env.TZ exactly as the file found it", () => {
    expect(process.env.TZ).toBe(TZ_AT_LOAD);
    expect(process.env.TZ).not.toBe("undefined");
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

describe("the driver split holds for every overrun the ledger can hold", () => {
  afterEach(() => vi.restoreAllMocks());

  /**
   * THE ROUNDING TIE. The split is `DRIVER_SPLIT` (0.62) of the overrun, and
   * the memo prints whole dollars — so with round-to-nearest, an overrun of
   * $2 splits 1/1 and an overrun of $4 splits 2/2. Both TIE, and a tie plants
   * no VAR-TIMING cue at all, which is exactly what the builder's
   * `DriverSplitError` refuses. The route then had no answer but HTTP 500:
   * the attach chain died on a $2 overrun the ledger is perfectly entitled to
   * hold. The split must put timing strictly above the one-off for EVERY
   * overrun, not merely for the seed's current one.
   */
  it.each([
    // 2 and 4 are the ties; the rest bracket them, up to the seed's own.
    { overrun: 1 },
    { overrun: 2 },
    { overrun: 3 },
    { overrun: 4 },
    { overrun: 5 },
    { overrun: 7 },
    { overrun: 19_440 },
  ])(
    "serves a memo whose timing driver is strictly the larger for an overrun of $overrun",
    async ({ overrun }) => {
      const plan = 216_000;
      stubLedger(store, { ...overrunPoint("2026-08"), actual: plan + overrun });

      const res = await call();
      expect(res.status).toBe(200);

      const amounts = [...(await textOf(res)).matchAll(/\$[\d,]+/g)].map((m) =>
        Number(m[0].replace(/[$,]/g, "")),
      );
      // Document order: actual, plan, overrun (Summary), then the two drivers.
      const [timingUsd, oneOffUsd] = amounts.slice(3);
      expect(timingUsd + oneOffUsd).toBe(overrun);
      expect(timingUsd).toBeGreaterThan(oneOffUsd);
    },
  );
});

describe("the builder's refusals reach the caller as refusals, not as faults", () => {
  afterEach(async () => {
    vi.doUnmock("@/skins/exec/data/budget-memo-pdf");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  /**
   * `buildBudgetMemoPdf` refusing an input is a statement about THE LEDGER —
   * there is no overrun this memo's prose can narrate — not a fault in this
   * route. Reporting it as HTTP 500 sent whoever is debugging beat 3d to the
   * server logs hunting a crash that never happened, and buried the one fact
   * that explains the failure. The breach here carries a positive
   * `variancePct` while its point sits AT plan, so the route's own sign guard
   * passes it through and the builder is what refuses.
   */
  it("maps a non-overrun the route's own guard let through to a coded 404", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const point = { ...overrunPoint("2026-08"), actual: 216_000 };
    vi.spyOn(store, "exceptions").mockReturnValue([
      {
        metricId: "opex",
        period: "2026-08",
        department: "distribution",
        // Skewed: positive here, flat in the point the memo would print.
        variancePct: 0.09,
        explained: false,
      },
    ]);
    vi.spyOn(store, "metricSeries").mockReturnValue([point]);

    const res = await call();

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "NOT_AN_OVERRUN" });
    expect(warn).toHaveBeenCalled();
  });

  /**
   * The other refusal, forced from the builder itself: with the split fixed
   * above, no ledger value reaches it any more, so the mapping can only be
   * exercised by making the builder throw.
   */
  it("maps a broken driver split to its own code rather than a bare 500", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("@/skins/exec/data/budget-memo-pdf", async (importOriginal) => {
      // The error is constructed from the ORIGINAL module resolved through
      // this factory, not from this file's own import: after
      // `vi.resetModules()` the route sees a fresh module instance, and an
      // error thrown from the stale one would fail the route's `instanceof`
      // for a reason that has nothing to do with the mapping under test.
      const actual = await importOriginal<{
        DriverSplitError: new (message: string) => Error;
      }>();
      return {
        ...actual,
        buildBudgetMemoPdf: () => {
          throw new actual.DriverSplitError("drivers 1 + 1 do not add up");
        },
      };
    });
    const { GET: freshGet } = await import("./route");

    const res = await freshGet();

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "DRIVER_SPLIT" });
    expect(error).toHaveBeenCalled();
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
