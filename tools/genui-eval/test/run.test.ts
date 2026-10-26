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
