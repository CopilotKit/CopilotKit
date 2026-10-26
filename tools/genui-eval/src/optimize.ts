import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultGenerativeUIPromptSpec } from "@copilotkit/shared";
import type { GenerativeUIPromptSpec } from "@copilotkit/shared";
import { loadCases, selectCases } from "./cases";
import type { EvalCase } from "./cases";
import type { EvalConfig, ResolvedPlan, Transport } from "./config";
import { costOf } from "./cost";
import { renderedPrompts } from "./harness";
import { createLanguageModel } from "./models";
import {
  MAX_TOKEN_GROWTH,
  reflect,
  reflectionOutputCap,
  reflectionPrompt,
} from "./reflect";
import { overallScore, tierRates } from "./report";
import type { TierRates } from "./report";
import { RESULTS_DIR, newRunId, readRun } from "./results";
import type { SampleRecord } from "./results";
import { promptFingerprint, runEval } from "./run";
import { clearlyDifferent, wilson } from "./stats";
import type { Rate } from "./stats";

/** One prompt candidate of the search. */
export interface Candidate {
  id: string;
  parent?: string;
  /** How it was made: the starting point, a reflection, or a merge. */
  origin: "baseline" | "reflection" | "merge";
  spec: GenerativeUIPromptSpec;
  /** The mean sample score of each training case (validity, fidelity, judgement). */
  perCase: Record<string, number>;
  trainScore: number;
  /** Prompt tokens of the rendered guide, by transport. */
  promptTokens: Partial<Record<Transport, number>>;
  /** The training samples, for the next reflection. */
  samples: SampleRecord[];
  heldout?: { perModel: Record<string, TierRates>; overall: Rate };
  accepted?: { ok: boolean; reasons: string[] };
}

/** The score of one sample: the share of validity, fidelity and judgement it passed (ungraded counts as failed). */
export function sampleScore(sample: SampleRecord) {
  // A tier the judge could not grade counts as failed: a failing judge
  // must never make a candidate look better.
  const tiers = [
    sample.tiers.validity,
    sample.tiers.fidelity,
    sample.tiers.judgement,
  ];
  return tiers.filter((t) => t.pass === true).length / tiers.length;
}

/** The mean sample score per case. */
export function perCaseScores(samples: readonly SampleRecord[]) {
  const byCase = new Map<string, number[]>();
  for (const s of samples)
    byCase.set(s.case, [...(byCase.get(s.case) ?? []), sampleScore(s)]);
  return Object.fromEntries(
    [...byCase].map(([id, xs]) => [
      id,
      xs.reduce((a, b) => a + b, 0) / xs.length,
    ]),
  );
}

const meanOf = (scores: Record<string, number>, ids?: readonly string[]) => {
  const keys = ids ?? Object.keys(scores);
  const xs = keys
    .map((k) => scores[k])
    .filter((x): x is number => x !== undefined);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
};

/**
 * The candidates that are best on at least one case (ties count for all).
 * Keeping them, not just the best overall, keeps ideas that only help some
 * requests alive for later combination.
 */
export function paretoFront(candidates: readonly Candidate[]): Candidate[] {
  const cases = [...new Set(candidates.flatMap((c) => Object.keys(c.perCase)))];
  const wins = new Map<string, number>();
  for (const id of cases) {
    const best = Math.max(...candidates.map((c) => c.perCase[id] ?? -1));
    for (const c of candidates)
      if ((c.perCase[id] ?? -1) === best)
        wins.set(c.id, (wins.get(c.id) ?? 0) + 1);
  }
  return candidates.filter((c) => (wins.get(c.id) ?? 0) > 0);
}

/** A seeded random number generator, so a search can be repeated. */
export function seededRandom(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

/**
 * The share of samples that pass validity, fidelity and judgement all at
 * once, with its interval. One trial per sample: the tiers of one answer go
 * together, so counting them as three trials would overstate confidence.
 * Ungraded counts as failed.
 */
function pooledRate(samples: readonly SampleRecord[]) {
  const passes = samples.filter((s) =>
    [s.tiers.validity, s.tiers.fidelity, s.tiers.judgement].every(
      (t) => t.pass === true,
    ),
  ).length;
  return wilson(passes, samples.length);
}

/**
 * The acceptance rule. A candidate replaces the baseline only if no model
 * gets worse at validity on the held-out cases, it is clearly better on
 * them (intervals apart), and its guide is at most 10% longer.
 */
export function accept(
  candidate: Candidate,
  baseline: Candidate,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!candidate.heldout || !baseline.heldout)
    return { ok: false, reasons: ["not scored on the held-out cases"] };
  for (const [model, rates] of Object.entries(baseline.heldout.perModel)) {
    const mine = candidate.heldout.perModel[model];
    if (!mine) continue;
    if (mine.validity.rate < rates.validity.rate) {
      reasons.push(
        `validity got worse on ${model} (${(rates.validity.rate * 100).toFixed(0)}% -> ${(mine.validity.rate * 100).toFixed(0)}%)`,
      );
    }
  }
  const better =
    candidate.heldout.overall.rate > baseline.heldout.overall.rate &&
    clearlyDifferent(candidate.heldout.overall, baseline.heldout.overall);
  if (!better) reasons.push("not clearly better on the held-out cases");
  for (const [transport, tokens] of Object.entries(
    candidate.promptTokens,
  ) as Array<[Transport, number]>) {
    const base = baseline.promptTokens[transport];
    if (base && tokens > base * (1 + MAX_TOKEN_GROWTH)) {
      reasons.push(
        `${transport} guide grew ${(((tokens - base) / base) * 100).toFixed(0)}% (limit ${MAX_TOKEN_GROWTH * 100}%)`,
      );
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Orders candidates best first: higher score wins; within about one
 * interval of each other, the shorter prompt wins.
 */
export function rankCandidates(
  candidates: readonly Candidate[],
  score: (c: Candidate) => number,
  tolerance = 0.02,
) {
  const tokens = (c: Candidate) =>
    Object.values(c.promptTokens).reduce((a, b) => a + (b ?? 0), 0);
  return [...candidates].sort((a, b) => {
    const diff = score(b) - score(a);
    if (Math.abs(diff) > tolerance) return diff;
    return tokens(a) - tokens(b);
  });
}

/** Two candidates combined: the markdown section of one, the tool section and schema of the other. */
export function mergeSpecs(
  a: GenerativeUIPromptSpec,
  b: GenerativeUIPromptSpec,
): GenerativeUIPromptSpec {
  return {
    markdown: structuredClone(a.markdown),
    tool: structuredClone(b.tool),
    schema: {
      markdown: structuredClone(a.schema.markdown),
      tool: structuredClone(b.schema.tool),
    },
    descriptions: { ...b.descriptions, ...a.descriptions },
  };
}

export interface OptimizeOptions {
  config: EvalConfig;
  plan: ResolvedPlan;
  budgetUsd: number;
  rounds: number;
  batchSize?: number;
  /** Rounds with no new candidate before the search stops. */
  plateau?: number;
  /** Start from this spec instead of the prompts that ship. */
  from?: GenerativeUIPromptSpec;
  seed?: number;
  root?: string;
  log?: (line: string) => void;
}

/**
 * Searches for a better prompt spec. Every candidate is scored on the
 * training cases; the best ones are then scored on the held-out cases and
 * checked against the acceptance rule. The optimizer never writes to the
 * repo: it writes the candidates, a leaderboard, and the winner's spec,
 * rendered prompt and diff to `results/optimize-<id>/`.
 */
export async function optimize(options: OptimizeOptions) {
  const { config, plan } = options;
  const root = options.root ?? RESULTS_DIR;
  const log = options.log ?? (() => {});
  const batchSize = options.batchSize ?? 6;
  const plateau = options.plateau ?? 5;
  const random = seededRandom(options.seed ?? 42);
  const outDir = `${root}optimize-${newRunId()}/`;
  mkdirSync(`${outDir}candidates/`, { recursive: true });

  const train = selectCases(loadCases("train"), plan.cases);
  const heldout = selectCases(loadCases("heldout"), plan.cases);
  const messages = Object.fromEntries(train.map((c) => [c.id, c.message]));
  const reflectionModel = createLanguageModel({ model: plan.reflection });
  let spent = 0;
  const remaining = () => options.budgetUsd - spent;

  /** Scores a spec on some cases; returns the samples, or undefined when the budget ran out. */
  const evaluate = async (
    spec: GenerativeUIPromptSpec,
    cases: EvalCase[],
    split: "train" | "heldout",
  ) => {
    if (remaining() <= 0) return undefined;
    const run = await runEval({
      config,
      plan,
      split,
      budgetUsd: remaining(),
      spec,
      kind: "optimize-candidate",
      root,
      cases: cases.map((c) => ({ case: c, split })),
    });
    spent += run.totals.costUsd;
    if (run.stopped) return undefined;
    return readRun(run.id, root).samples;
  };

  const makeCandidate = (
    spec: GenerativeUIPromptSpec,
    samples: SampleRecord[],
    origin: Candidate["origin"],
    parent?: string,
  ): Candidate => {
    const perCase = perCaseScores(samples);
    const candidate: Candidate = {
      id: `c${pool.length}`,
      ...(parent ? { parent } : {}),
      origin,
      spec,
      perCase,
      trainScore: meanOf(perCase),
      promptTokens: promptFingerprint(spec, plan.transports).sizes,
      samples,
    };
    writeFileSync(
      `${outDir}candidates/${candidate.id}.json`,
      `${JSON.stringify({ ...candidate, samples: undefined }, null, 2)}\n`,
    );
    return candidate;
  };

  const pool: Candidate[] = [];
  const startSpec = options.from ?? defaultGenerativeUIPromptSpec();
  log(`scoring the starting prompt on ${train.length} training cases`);
  const startSamples = await evaluate(startSpec, train, "train");
  if (!startSamples)
    throw new Error(
      "The budget does not cover scoring the starting prompt once.",
    );
  const baseline = makeCandidate(startSpec, startSamples, "baseline");
  pool.push(baseline);
  const tokenLimits = Object.fromEntries(
    Object.entries(baseline.promptTokens).map(([t, n]) => [
      t,
      Math.floor((n ?? 0) * (1 + MAX_TOKEN_GROWTH)),
    ]),
  ) as Partial<Record<Transport, number>>;

  let quiet = 0;
  for (
    let round = 1;
    round <= options.rounds && quiet < plateau && remaining() > 0;
    round++
  ) {
    // Every third round combines two candidates of the front.
    const front = paretoFront(pool);
    if (round % 3 === 0 && front.length >= 2) {
      const [a, b] = rankCandidates(front, (c) => c.trainScore);
      const merged = mergeSpecs(a.spec, b.spec);
      const samples = await evaluate(merged, train, "train");
      if (!samples) break;
      const child = makeCandidate(merged, samples, "merge", `${a.id}+${b.id}`);
      pool.push(child);
      log(
        `round ${round}: merged ${a.id} and ${b.id} -> ${child.id} train ${(child.trainScore * 100).toFixed(1)}%`,
      );
      quiet = paretoFront(pool).includes(child) ? 0 : quiet + 1;
      continue;
    }
    // Pick a parent from the front and a batch of training cases.
    const parent = front[Math.floor(random() * front.length)];
    const batch = [...train].sort(() => random() - 0.5).slice(0, batchSize);
    const batchIds = batch.map((c) => c.id);
    const failing = parent.samples
      .filter((s) => batchIds.includes(s.case) && sampleScore(s) < 1)
      .slice(0, 12)
      .map((sample) => ({ sample, message: messages[sample.case] }));
    if (failing.length === 0) {
      log(`round ${round}: ${parent.id} has no failures on its batch`);
      quiet++;
      continue;
    }
    // The reflection call is charged after it returns, so its estimate
    // at its worst (the prompt in, the capped reply out) must fit first.
    const reflectionEstimate = costOf(
      config,
      plan.reflection,
      Math.ceil(reflectionPrompt(parent.spec, failing, tokenLimits).length / 4),
      reflectionOutputCap(parent.spec),
    );
    if (reflectionEstimate > remaining()) {
      log(
        `round ${round}: the budget left does not cover a reflection; stopping`,
      );
      break;
    }
    const reflected = await reflect(
      reflectionModel,
      parent.spec,
      failing,
      tokenLimits,
    );
    spent += costOf(
      config,
      plan.reflection,
      reflected.tokens.input,
      reflected.tokens.output,
    );
    if (!reflected.spec || reflected.problems.length > 0) {
      log(
        `round ${round}: candidate discarded (${reflected.problems.map((p) => p.message).join("; ")})`,
      );
      quiet++;
      continue;
    }
    const batchSamples = await evaluate(reflected.spec, batch, "train");
    if (!batchSamples) break;
    const childBatch = meanOf(perCaseScores(batchSamples), batchIds);
    const parentBatch = meanOf(parent.perCase, batchIds);
    if (childBatch < parentBatch) {
      log(
        `round ${round}: child of ${parent.id} worse on its batch (${(childBatch * 100).toFixed(0)}% < ${(parentBatch * 100).toFixed(0)}%)`,
      );
      quiet++;
      continue;
    }
    const samples = await evaluate(reflected.spec, train, "train");
    if (!samples) break;
    const child = makeCandidate(
      reflected.spec,
      samples,
      "reflection",
      parent.id,
    );
    pool.push(child);
    log(
      `round ${round}: ${child.id} from ${parent.id} train ${(child.trainScore * 100).toFixed(1)}% (${Object.entries(
        child.promptTokens,
      )
        .map(([t, n]) => `${t} ${n}`)
        .join(", ")} tokens)`,
    );
    quiet = paretoFront(pool).includes(child) ? 0 : quiet + 1;
  }

  // The exam: the baseline and the best three candidates on the held-out cases.
  const finalists = [
    baseline,
    ...rankCandidates(
      pool.filter((c) => c !== baseline),
      (c) => c.trainScore,
    ).slice(0, 3),
  ];
  for (const candidate of finalists) {
    const samples = await evaluate(candidate.spec, heldout, "heldout");
    if (!samples) break;
    const perModel = Object.fromEntries(
      [...new Set(samples.map((s) => s.model))].map((m) => [
        m,
        tierRates(samples.filter((s) => s.model === m)),
      ]),
    );
    candidate.heldout = { perModel, overall: pooledRate(samples) };
  }
  for (const candidate of finalists.slice(1))
    candidate.accepted = accept(candidate, baseline);
  const accepted = rankCandidates(
    finalists.filter((c) => c.accepted?.ok),
    (c) => c.heldout?.overall.rate ?? 0,
  );
  const winner = accepted[0];

  const leaderboard = rankCandidates(pool, (c) => c.trainScore).map((c) => ({
    id: c.id,
    origin: c.origin,
    parent: c.parent,
    trainScore: c.trainScore,
    trainOverall: overallScore(tierRates(c.samples)),
    promptTokens: c.promptTokens,
    heldout: c.heldout && {
      overall: c.heldout.overall.rate,
      low: c.heldout.overall.low,
      high: c.heldout.overall.high,
    },
    accepted: c.accepted,
  }));
  writeFileSync(
    `${outDir}leaderboard.json`,
    `${JSON.stringify({ spentUsd: spent, leaderboard }, null, 2)}\n`,
  );
  if (winner) writeWinnerFiles(outDir, winner.spec, baseline.spec, winner.id);
  return { outDir, spentUsd: spent, leaderboard, winner, baseline };
}

/**
 * Writes the winner's spec, its rendered prompts, and a diff of the
 * rendered prompts against the baseline's, for a person or an agent to
 * copy into the builders.
 */
export function writeWinnerFiles(
  outDir: string,
  winner: GenerativeUIPromptSpec,
  baseline: GenerativeUIPromptSpec,
  id: string,
) {
  writeFileSync(
    `${outDir}winner.spec.json`,
    `${JSON.stringify(winner, null, 2)}\n`,
  );
  const after = renderedPrompts(winner);
  const before = renderedPrompts(baseline);
  writeFileSync(
    `${outDir}winner.prompt.md`,
    `# Winner ${id}\n\n## markdown\n\n${after.markdown}\n\n## tool\n\n${after.tool}\n`,
  );
  writeFileSync(
    `${outDir}winner.diff`,
    `${textDiff(before.markdown, after.markdown, "markdown")}${textDiff(before.tool, after.tool, "tool")}`,
  );
}

/** A unified diff of two texts, through git (no repo needed). */
function textDiff(before: string, after: string, name: string) {
  const dir = join(tmpdir(), `genui-eval-diff-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.before`), before);
  writeFileSync(join(dir, `${name}.after`), after);
  try {
    execFileSync(
      "git",
      ["diff", "--no-index", "--no-color", `${name}.before`, `${name}.after`],
      { cwd: dir, encoding: "utf8" },
    );
    return "";
  } catch (error) {
    return String((error as { stdout?: string }).stdout ?? "");
  }
}
