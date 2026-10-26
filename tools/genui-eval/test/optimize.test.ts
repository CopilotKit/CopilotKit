import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultGenerativeUIPromptSpec } from "@copilotkit/shared";
import { afterAll, describe, expect, it } from "vitest";
import { defineEvalConfig, resolvePlan } from "../src/config";
import {
  accept,
  mergeSpecs,
  optimize,
  paretoFront,
  rankCandidates,
  writeWinnerFiles,
} from "../src/optimize";
import type { Candidate } from "../src/optimize";
import { checkCandidate } from "../src/reflect";
import { wilson } from "../src/stats";

const rates = (validity: number) => ({
  validity: wilson(validity, 10),
  fidelity: wilson(8, 10),
  judgement: wilson(8, 10),
  quality: wilson(8, 10),
});

function candidate(id: string, over: Partial<Candidate> = {}): Candidate {
  return {
    id,
    origin: "reflection",
    spec: defaultGenerativeUIPromptSpec(),
    perCase: {},
    trainScore: 0.5,
    promptTokens: { markdown: 1000, tool: 2000 },
    samples: [],
    ...over,
  };
}

describe("search helpers", () => {
  it("keeps every candidate that is best on at least one case", () => {
    const a = candidate("a", { perCase: { x: 1, y: 0 } });
    const b = candidate("b", { perCase: { x: 0, y: 1 } });
    const c = candidate("c", { perCase: { x: 0.5, y: 0.5 } });
    expect(paretoFront([a, b, c]).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("ranks by score and gives near ties to the shorter prompt", () => {
    const long = candidate("long", { trainScore: 0.8 });
    const short = candidate("short", {
      trainScore: 0.79,
      promptTokens: { markdown: 500, tool: 1000 },
    });
    const best = candidate("best", { trainScore: 0.95 });
    expect(
      rankCandidates([long, short, best], (c) => c.trainScore).map((c) => c.id),
    ).toEqual(["best", "short", "long"]);
  });

  it("merges the markdown section of one spec with the tool section of another", () => {
    const a = defaultGenerativeUIPromptSpec();
    a.markdown.intro = "A";
    const b = defaultGenerativeUIPromptSpec();
    b.tool.intro = "B";
    const merged = mergeSpecs(a, b);
    expect([merged.markdown.intro, merged.tool.intro]).toEqual(["A", "B"]);
  });
});

describe("sampleScore", () => {
  it("counts a tier the judge could not grade as failed, so a broken judge never helps", async () => {
    const { sampleScore } = await import("../src/optimize");
    const tier = (pass: boolean | null) => ({ pass, reasons: [] });
    const s = {
      tiers: {
        validity: tier(true),
        fidelity: tier(true),
        judgement: tier(null),
        quality: tier(null),
      },
    };
    expect(sampleScore(s as never)).toBeCloseTo(2 / 3, 5);
  });
});

describe("accept", () => {
  const baseline = candidate("base", {
    heldout: {
      perModel: { m1: rates(9), m2: rates(9) },
      overall: wilson(60, 100),
    },
  });

  it("accepts a candidate that is clearly better, no worse at validity, and not much longer", () => {
    const good = candidate("good", {
      heldout: {
        perModel: { m1: rates(10), m2: rates(9) },
        overall: wilson(90, 100),
      },
      promptTokens: { markdown: 1050, tool: 2100 },
    });
    expect(accept(good, baseline)).toEqual({ ok: true, reasons: [] });
  });

  it("rejects a validity regression on one model, a small gain, and a 15% longer prompt", () => {
    const bad = candidate("bad", {
      heldout: {
        perModel: { m1: rates(10), m2: rates(7) },
        overall: wilson(65, 100),
      },
      promptTokens: { markdown: 1150, tool: 2000 },
    });
    const { ok, reasons } = accept(bad, baseline);
    expect(ok).toBe(false);
    expect(reasons).toEqual([
      "validity got worse on m2 (90% -> 70%)",
      "not clearly better on the held-out cases",
      "markdown guide grew 15% (limit 10%)",
    ]);
  });
});

describe("checkCandidate", () => {
  const parent = defaultGenerativeUIPromptSpec();
  const limits = { markdown: 1_000_000, tool: 1_000_000 };

  it("accepts the default spec, and drops unknown description keys", () => {
    const spec = {
      ...defaultGenerativeUIPromptSpec(),
      descriptions: { Map: "A map", Nope: "x" },
    };
    const result = checkCandidate(spec, parent, limits);
    expect(result.problems).toEqual([]);
    expect(result.spec.descriptions).toEqual({ Map: "A map" });
  });

  it("rejects a changed block condition and a guide over the token limit", () => {
    const spec = defaultGenerativeUIPromptSpec();
    spec.markdown.rules = spec.markdown.rules.filter(
      (item) => typeof item === "string" || !item.when.includes("checks"),
    );
    const kinds = checkCandidate(spec, parent, { markdown: 10 }).problems.map(
      (p) => p.kind,
    );
    expect(kinds).toEqual(["when", "tokens"]);
  });
});

describe("optimize offline", () => {
  const root = `${mkdtempSync(join(tmpdir(), "genui-eval-opt-"))}/`;
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("scores the baseline, makes candidates with the fake reflection, and writes the leaderboard", async () => {
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
      transports: ["markdown"],
      budgetUsd: 1,
      judge: { model: "fake:judge" },
      reflection: { model: "fake:reflect" },
      concurrency: 8,
    });
    const lines: string[] = [];
    const result = await optimize({
      config,
      plan: resolvePlan(config, "offline"),
      budgetUsd: 1,
      rounds: 2,
      batchSize: 4,
      root,
      log: (line) => lines.push(line),
    });
    expect(result.leaderboard.length).toBeGreaterThanOrEqual(2);
    expect(result.baseline.heldout?.perModel.fake).toBeDefined();
    expect(existsSync(`${result.outDir}leaderboard.json`)).toBe(true);
    const board = JSON.parse(
      readFileSync(`${result.outDir}leaderboard.json`, "utf8"),
    );
    expect(board.leaderboard[0].promptTokens.markdown).toBeGreaterThan(0);
    // The fake scores every prompt the same, so nothing is clearly better.
    expect(result.winner).toBeUndefined();
    expect(lines.some((l) => l.startsWith("round 1:"))).toBe(true);
  });
});

describe("writeWinnerFiles", () => {
  it("writes the spec, the rendered prompts and a diff against the baseline", () => {
    const dir = `${mkdtempSync(join(tmpdir(), "genui-eval-win-"))}/`;
    const winner = defaultGenerativeUIPromptSpec();
    winner.markdown.intro = "A SHORTER INTRO.";
    writeWinnerFiles(dir, winner, defaultGenerativeUIPromptSpec(), "c3");
    expect(
      JSON.parse(readFileSync(`${dir}winner.spec.json`, "utf8")).markdown.intro,
    ).toBe("A SHORTER INTRO.");
    expect(readFileSync(`${dir}winner.prompt.md`, "utf8")).toContain(
      "# Winner c3",
    );
    const diff = readFileSync(`${dir}winner.diff`, "utf8");
    expect(diff).toContain("+A SHORTER INTRO.");
    expect(diff).toContain("-You can show interactive UI in your reply.");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("optimize budget", () => {
  it("stops before a reflection the budget cannot cover", async () => {
    const root = `${mkdtempSync(join(tmpdir(), "genui-eval-optb-"))}/`;
    const config = defineEvalConfig({
      models: [{ id: "fake", model: "fake:offline" }],
      presets: {
        offline: {
          models: ["fake"],
          cases: "tag:smoke",
          samples: 1,
          judge: "fake:judge",
          reflection: "fake:reflect",
        },
      },
      transports: ["markdown"],
      budgetUsd: 1,
      judge: { model: "fake:judge" },
      reflection: { model: "fake:reflect" },
      prices: { "fake:reflect": { input: 1_000_000, output: 1_000_000 } },
    });
    const lines: string[] = [];
    const result = await optimize({
      config,
      plan: resolvePlan(config, "offline"),
      budgetUsd: 1,
      rounds: 3,
      root,
      log: (line) => lines.push(line),
    });
    expect(result.spentUsd).toBeLessThanOrEqual(1);
    expect(lines.some((l) => l.includes("does not cover a reflection"))).toBe(
      true,
    );
    rmSync(root, { recursive: true, force: true });
  });
});
