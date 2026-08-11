import { describe, expect, it } from "vitest";
import {
  DEFAULT_LENS,
  parseLens,
  lensToParams,
  lensSummary,
  isLensAxisSet,
} from "./lens";

describe("parseLens", () => {
  it("falls back to the default lens for empty input", () => {
    expect(parseLens(new URLSearchParams())).toEqual(DEFAULT_LENS);
  });

  it("reads every axis from query params", () => {
    const lens = parseLens(
      new URLSearchParams(
        "period=h1-2026&compare=yoy&segment=enterprise&region=emea&grain=quarterly&currency=constant",
      ),
    );
    expect(lens).toEqual({
      period: "h1-2026",
      compare: "yoy",
      segment: "enterprise",
      region: "emea",
      grain: "quarterly",
      currency: "constant",
    });
  });

  it("ignores unknown values rather than throwing, so a hand-typed URL never 500s", () => {
    const lens = parseLens(
      new URLSearchParams("period=next-tuesday&segment=whales"),
    );
    expect(lens.period).toBe(DEFAULT_LENS.period);
    expect(lens.segment).toBe(DEFAULT_LENS.segment);
  });

  it("accepts a plain object (Next.js searchParams)", () => {
    expect(parseLens({ region: "apac" }).region).toBe("apac");
  });
});

describe("lensToParams", () => {
  it("round-trips through parseLens", () => {
    const lens = parseLens(
      new URLSearchParams(
        "period=q2-2026&compare=vs-plan&region=namer&currency=constant",
      ),
    );
    expect(parseLens(lensToParams(lens))).toEqual(lens);
  });

  it("omits axes that are at their default, keeping demo URLs short and readable", () => {
    expect(lensToParams(DEFAULT_LENS).toString()).toBe("");
  });
});

describe("isLensAxisSet", () => {
  it("is true only for axes moved off their default — this drives the highlight", () => {
    const lens = { ...DEFAULT_LENS, region: "emea" as const };
    expect(isLensAxisSet(lens, "region")).toBe(true);
    expect(isLensAxisSet(lens, "segment")).toBe(false);
  });
});

describe("lensSummary", () => {
  it("renders human labels for the confirm card, in lever order", () => {
    const summary = lensSummary({
      period: "q3-2026",
      compare: "vs-plan",
      segment: "enterprise",
      region: "emea",
      grain: "monthly",
      currency: "constant",
    });
    expect(summary.map((s) => s.label)).toEqual([
      "Period",
      "Compare",
      "Segment",
      "Region",
      "Grain",
      "Currency",
    ]);
    expect(summary[1].value).toBe("vs Plan");
    expect(summary[3].value).toBe("EMEA");
  });
});
