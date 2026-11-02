import { describe, expect, it } from "vitest";
import {
  buildReport,
  failures,
  formatReport,
  reasonKey,
  tierRates,
} from "../src/report";
import type { RunRecord, SampleRecord } from "../src/results";
import { wilson } from "../src/stats";

function sample(
  over: Partial<SampleRecord> & { pass?: boolean },
): SampleRecord {
  const pass = over.pass ?? true;
  const tier = (p: boolean) => ({
    pass: p,
    reasons: p
      ? []
      : ['invalid props: value: Expected number, received string at "x"'],
  });
  return {
    case: "c1",
    split: "train",
    tags: ["form"],
    model: "m",
    modelName: "vendor/m",
    transport: "markdown",
    sample: 0,
    tiers: {
      validity: tier(true),
      fidelity: tier(pass),
      judgement: tier(true),
      quality: { pass: null, reasons: [], score: null },
    },
    promptTokens: 4000,
    outputTokens: 500,
    costUsd: 0.01,
    judgeCostUsd: 0.001,
    components: ["Slider"],
    surfaces: 1,
    output: { text: "reply", toolCalls: [], parseErrors: [] },
    ...over,
  };
}

const run = (id: string, sizes = { markdown: 9000 }): RunRecord => ({
  id,
  kind: "run",
  startedAt: "2026-10-26T00:00:00Z",
  gitSha: "abcdef1234567",
  promptHashes: { markdown: "000000000000" },
  promptSizes: sizes,
  preset: "test",
  models: [{ id: "m", model: "vendor/m", params: {} }],
  validityMode: "raw",
  transports: ["markdown"],
  split: "both",
  samplesPerCase: 3,
  judge: "fake:judge",
  budgetUsd: 1,
  estimatedCostUsd: 0,
  totals: { samples: 0, costUsd: 0 },
});

describe("stats", () => {
  it("gives the Wilson interval of 2 out of 3", () => {
    const r = wilson(2, 3);
    expect(r.rate).toBeCloseTo(0.667, 3);
    expect(r.low).toBeCloseTo(0.208, 2);
    expect(r.high).toBeCloseTo(0.939, 2);
  });

  it("leaves ungraded samples out of a tier", () => {
    const rates = tierRates([sample({})]);
    expect(rates.quality.total).toBe(0);
    expect(rates.validity).toMatchObject({ passes: 1, total: 1 });
  });

  it("gives an empty tier no rate instead of 0%", () => {
    expect(wilson(0, 0).rate).toBeNull();
  });
});

describe("empty tiers", () => {
  const ungraded = { pass: null, reasons: [], score: null };
  const judgeless = (s: SampleRecord): SampleRecord => ({
    ...s,
    tiers: { ...s.tiers, judgement: ungraded, quality: ungraded },
  });

  it("leaves an empty tier out of the overall score, the deltas and the table", () => {
    const mine = [judgeless(sample({}))];
    const theirs = [sample({ pass: false })];
    const report = buildReport(
      { run: run("r2"), samples: mine },
      { run: run("r1"), samples: theirs },
    );
    // validity 100%, fidelity 100%; judgement has no rate.
    expect(report.totals.overall).toBe(1);
    expect(report.base!.delta.map((d) => d.tier)).toEqual([
      "validity",
      "fidelity",
    ]);
    const text = formatReport(report);
    expect(text).not.toContain("judgement -");
    expect(text).toContain("–");
  });
});

describe("buildReport", () => {
  it.each(["model", "provider", "params"] as const)(
    "does not attribute a different %s to the prompt",
    (field) => {
      const before = run("before");
      const after = run("after");
      after.models = [
        {
          ...after.models[0],
          ...{
            model: { model: "vendor/other" },
            provider: { provider: "other-host" },
            params: { params: { temperature: 1 } },
          }[field],
        },
      ];
      const report = buildReport(
        { run: after, samples: [sample({ modelName: after.models[0].model })] },
        { run: before, samples: [sample({ pass: false })] },
      );
      expect(report.base!.delta).toEqual([]);
      expect(report.base!.warnings.join(" ")).toContain(field);
    },
  );

  it("warns when legacy runs did not record generation parameters", () => {
    const before = run("before");
    delete before.models[0].params;
    const report = buildReport(
      { run: run("after"), samples: [sample({})] },
      { run: before, samples: [sample({})] },
    );
    expect(report.base!.warnings.join(" ")).toContain(
      "parameters were not recorded",
    );
  });

  it("does not compare raw validity with legacy post-repair validity", () => {
    const before = run("before");
    delete before.validityMode;
    const report = buildReport(
      { run: run("after"), samples: [sample({})] },
      { run: before, samples: [sample({})] },
    );
    expect(report.base!.delta.some((d) => d.tier === "validity")).toBe(false);
    expect(report.base!.warnings.join(" ")).toContain(
      "validity definitions differ",
    );
  });

  it("reports recovered validity and repaired lines separately", () => {
    const repaired = sample({
      repairedLines: 1,
      recoveredValidity: { pass: true, reasons: [] },
    });
    repaired.tiers.validity = { pass: false, reasons: ["repaired fence line"] };
    const report = buildReport({ run: run("r"), samples: [repaired] });
    expect(report.models[0].train.validity.rate).toBe(0);
    expect(report.models[0].recoveredValidity.train.rate).toBe(1);
    expect(formatReport(report)).toContain("1 repaired lines");
    expect(formatReport(report)).toContain("validity after recovery");
  });

  const samples = [
    sample({}),
    sample({ pass: false, sample: 1 }),
    sample({ pass: false, sample: 2 }),
    sample({ case: "h1", split: "heldout", pass: false }),
  ];

  it("reports training rates, held-out totals, and groups failure reasons", () => {
    const report = buildReport({ run: run("r1"), samples });
    const m = report.models[0];
    expect(m.train.fidelity).toMatchObject({ passes: 1, total: 3 });
    expect(m.heldout?.fidelity).toMatchObject({ passes: 0, total: 1 });
    expect(m.topFailures).toEqual([
      {
        reason:
          'fidelity: invalid props: value: Expected number, received string at "…"',
        count: 2,
      },
    ]);
    expect(formatReport(report)).toContain("held-out cases (totals only)");
  });

  it("shows the difference against a base run", () => {
    const better = samples.map((s) => ({
      ...s,
      tiers: { ...s.tiers, fidelity: { pass: true, reasons: [] } },
    }));
    const report = buildReport(
      { run: run("r2", { markdown: 8000 }), samples: better },
      { run: run("r1"), samples },
    );
    const delta = report.base!.delta.find(
      (d) => d.split === "train" && d.tier === "fidelity",
    );
    expect(delta?.delta).toBeCloseTo(2 / 3, 5);
    expect(formatReport(report)).toContain("(base: markdown 9000)");
    expect(report.base!.warnings).toEqual([]);
  });

  it("compares only the groups both runs cover, and warns when they differ", () => {
    const mine = [sample({}), sample({ case: "c2", pass: false })];
    const theirs = [sample({ pass: false })];
    const report = buildReport(
      { run: { ...run("r2"), stopped: "budget" }, samples: mine },
      { run: { ...run("r1"), judge: "other/judge" }, samples: theirs },
    );
    // c2 is only in this run, so fidelity is c1 against c1: 100% vs 0%.
    const delta = report.base!.delta.find((d) => d.tier === "fidelity");
    expect(delta?.delta).toBe(1);
    expect(report.base!.warnings).toEqual([
      "run r2 stopped early (budget)",
      "the runs used different judges (fake:judge vs other/judge)",
      "the runs cover different cases: compared on the 1 both have",
    ]);
    expect(formatReport(report)).toContain(
      "warning: the runs used different judges",
    );
  });
});

describe("cut replies", () => {
  it("counts replies cut at the token cap per model", () => {
    const report = buildReport({
      run: run("r4"),
      samples: [sample({ cut: true }), sample({ sample: 1 })],
    });
    expect(report.models[0].cut).toBe(1);
    expect(formatReport(report)).toContain(
      "m: 1 replies cut at the output token cap",
    );
  });
});

describe("cost per valid surface", () => {
  it("divides by the surfaces, not the replies", () => {
    const report = buildReport({
      run: run("r3"),
      samples: [sample({ surfaces: 3, costUsd: 0.09, judgeCostUsd: 0 })],
    });
    expect(report.models[0].costPerValidSurfaceUsd).toBeCloseTo(0.03, 6);
  });
});

describe("failures", () => {
  it("lists failing training samples and never a held-out one", () => {
    const rows = failures([
      sample({ pass: false }),
      sample({ case: "h1", split: "heldout", pass: false }),
      sample({ sample: 4 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].case).toBe("c1");
    expect(rows[0].failed.fidelity).toHaveLength(1);
  });

  it("groups reasons that differ only in quoted values and numbers", () => {
    expect(reasonKey('expected "a" got 12')).toBe(
      reasonKey('expected "b" got 7'),
    );
  });
});
