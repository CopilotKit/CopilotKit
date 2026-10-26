import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { defineEvalConfig, resolvePlan } from "../src/config";
import { readRun } from "../src/results";
import { runEval } from "../src/run";

const root = `${mkdtempSync(join(tmpdir(), "genui-eval-"))}/`;
afterAll(() => rmSync(root, { recursive: true, force: true }));

const config = defineEvalConfig({
  models: [{ id: "fake", model: "fake:offline" }],
  presets: {
    offline: {
      models: ["fake"],
      cases: "all",
      samples: 1,
      judge: "fake:judge",
      reflection: "fake:reflect",
    },
  },
  transports: ["markdown", "tool"],
  budgetUsd: 1,
  judge: { model: "fake:judge" },
  reflection: { model: "fake:reflect" },
  concurrency: 4,
});

describe("runEval", () => {
  it("runs every case on both transports and writes the run and one line per sample", async () => {
    const run = await runEval({
      config,
      plan: resolvePlan(config, "offline"),
      split: "both",
      budgetUsd: 1,
      root,
    });
    expect(run.stopped).toBeUndefined();
    expect(run.totals.samples).toBe(80);
    const { run: stored, samples } = readRun(run.id, root);
    expect(stored.finishedAt).toBeDefined();
    expect(stored.promptHashes.markdown).toMatch(/^[0-9a-f]{12}$/);
    expect(stored.promptSizes.markdown).toBeGreaterThan(1000);
    expect(samples).toHaveLength(80);
    const map = samples.find(
      (s) => s.case === "cafes-map" && s.transport === "markdown",
    );
    expect(map?.tiers.validity.pass).toBe(true);
    expect(map?.components).toContain("Map");
    expect(map?.tiers.judgement.score).toBe(0.8);
    const loan = samples.find(
      (s) => s.case === "loan-calculator" && s.transport === "markdown",
    );
    expect(loan?.tiers.fidelity.pass).toBe(false);
    expect(samples.filter((s) => s.split === "heldout")).toHaveLength(20);
  });

  it("stops at the budget and marks the run", async () => {
    const priced = defineEvalConfig({
      ...config,
      prices: { "fake:offline": { input: 1000, output: 1000 } },
    });
    const run = await runEval({
      config: priced,
      plan: resolvePlan(priced, "offline"),
      split: "train",
      budgetUsd: 0.01,
      root,
    });
    expect(run.stopped).toBe("budget");
    expect(run.totals.samples).toBe(0);
    const stored = JSON.parse(
      readFileSync(`${root}${run.id}/run.json`, "utf8"),
    );
    expect(stored.stopped).toBe("budget");
  });
});

describe("runEval with a failing judge", () => {
  it("leaves judgement ungraded instead of counting it as a pass", async () => {
    const broken = defineEvalConfig({
      ...config,
      presets: {
        offline: {
          models: ["fake"],
          cases: "tag:smoke",
          samples: 1,
          judge: "fake:no-judge",
          reflection: "fake:reflect",
        },
      },
      judge: { model: "fake:no-judge" },
    });
    const run = await runEval({
      config: broken,
      plan: resolvePlan(broken, "offline"),
      split: "train",
      budgetUsd: 1,
      root,
    });
    const { samples } = readRun(run.id, root);
    const map = samples.find(
      (s) => s.case === "cafes-map" && s.transport === "markdown",
    );
    expect(map?.tiers.judgement).toMatchObject({ pass: null, score: null });
    const prose = samples.find(
      (s) => s.case === "team-plan-estimator" && s.transport === "markdown",
    );
    expect(prose?.tiers.judgement.pass).toBe(false);
  });
});

describe("worstSampleCost", () => {
  it("bounds a sample by the capped reply and every judge attempt", async () => {
    const {
      worstSampleCost,
      MAX_OUTPUT_TOKENS,
      MAX_JUDGE_TOKENS,
      JUDGE_ATTEMPTS,
    } = await import("../src/cost");
    const priced = defineEvalConfig({
      ...config,
      prices: {
        "fake:offline": { input: 1, output: 2 },
        "fake:judge": { input: 3, output: 4 },
      },
    });
    const cost = worstSampleCost(priced, "fake:offline", "fake:judge", 1000);
    const expected =
      (1000 * 1 + MAX_OUTPUT_TOKENS * 2) / 1e6 +
      (JUDGE_ATTEMPTS *
        (MAX_JUDGE_TOKENS.input * 3 + MAX_JUDGE_TOKENS.output * 4)) /
        1e6;
    expect(cost).toBeCloseTo(expected, 10);
  });
});

describe("runEval budget with concurrency", () => {
  const priced = () =>
    defineEvalConfig({
      ...config,
      presets: {
        offline: {
          models: ["fake"],
          cases: "tag:smoke",
          samples: 1,
          judge: "fake:judge",
          reflection: "fake:reflect",
        },
      },
      // The worst case of a sample (8000 output tokens) is about $0.04; real use is far less.
      prices: { "fake:offline": { input: 0.001, output: 5 } },
      concurrency: 4,
    });

  it("waits for in-flight samples to free their reservations instead of stopping", async () => {
    const c = priced();
    const run = await runEval({
      config: c,
      plan: resolvePlan(c, "offline"),
      split: "train",
      budgetUsd: 0.1,
      root,
    });
    expect(run.stopped).toBeUndefined();
    expect(run.totals.samples).toBe(10);
  });

  it("counts the conversation of a case in the reservation", async () => {
    const c = priced();
    const { loadCases } = await import("../src/cases");
    const long = {
      ...loadCases("train")[0],
      history: [{ role: "user" as const, content: "x".repeat(400_000) }],
    };
    const pricedInput = defineEvalConfig({
      ...c,
      prices: { "fake:offline": { input: 1, output: 0 } },
    });
    const run = await runEval({
      config: pricedInput,
      plan: resolvePlan(pricedInput, "offline"),
      split: "train",
      budgetUsd: 0.05,
      root,
      cases: [{ case: long, split: "train" }],
    });
    expect(run.stopped).toBe("budget");
    expect(run.totals.samples).toBe(0);
  });
});
