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
  models: [{ id: "m", model: "vendor/m" }],
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
});

describe("buildReport", () => {
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
