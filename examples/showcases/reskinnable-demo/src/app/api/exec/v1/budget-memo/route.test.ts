import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "./route";
import * as store from "@/skins/exec/data/store";
import { toAscii } from "@/shell/documents";

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
