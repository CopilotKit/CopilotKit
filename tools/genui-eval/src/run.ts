import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import type { GenerativeUIPromptSpec } from "@copilotkit/shared";
import { loadCases, selectCases } from "./cases";
import type { EvalCase, Split } from "./cases";
import type { EvalConfig, ModelEntry, ResolvedPlan, Transport } from "./config";
import {
  MAX_OUTPUT_TOKENS,
  costOf,
  estimateSampleCost,
  worstSampleCost,
} from "./cost";
import { catalogFor, renderedPrompts, runSample } from "./harness";
import { JUDGE_PASS, judgeSample } from "./judge";
import { createLanguageModel, requireKey } from "./models";
import type { CallMeta } from "./models";
import { RenderChecker } from "./render-check";
import { RESULTS_DIR, appendSample, newRunId, writeRun } from "./results";
import type { RunRecord, SampleRecord } from "./results";
import { scoreCode } from "./score";

/** One sample to run. */
interface Task {
  case: EvalCase;
  split: Split;
  entry: ModelEntry;
  transport: Transport;
  sample: number;
}

export interface RunOptions {
  config: EvalConfig;
  plan: ResolvedPlan;
  /** Which cases: the training cases, the held-out cases, or both. */
  split: Split | "both";
  /** USD; the run stops before a sample that would go over it. */
  budgetUsd: number;
  /** A prompt spec instead of the prompts that ship. */
  spec?: GenerativeUIPromptSpec;
  /** The file the spec came from, for the record. */
  specFile?: string;
  kind?: RunRecord["kind"];
  /** The results root; tests use a temporary one. */
  root?: string;
  /** Cases instead of the case files (the optimizer's batches). */
  cases?: Array<{ case: EvalCase; split: Split }>;
  onProgress?: (done: number, total: number, sample: SampleRecord) => void;
}

const shortHash = (text: string) =>
  createHash("sha256").update(text).digest("hex").slice(0, 12);

/** The commit and a hash of the uncommitted changes. */
export function gitState(): { gitSha: string; dirtyHash?: string } {
  try {
    const gitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    // Tracked changes plus the untracked files: either makes the prompt differ from the commit.
    const diff = execSync("git diff HEAD", {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const untracked = execSync("git status --porcelain --untracked-files=all", {
      encoding: "utf8",
    })
      .split("\n")
      .filter((line) => line.startsWith("??"))
      .join("\n");
    const changes = diff + untracked;
    return changes ? { gitSha, dirtyHash: shortHash(changes) } : { gitSha };
  } catch {
    return { gitSha: "unknown" };
  }
}

/** The cases of a run, from the case files or given. */
function casesOf(options: RunOptions) {
  if (options.cases) return options.cases;
  const splits: Split[] =
    options.split === "both" ? ["train", "heldout"] : [options.split];
  return splits.flatMap((split) =>
    selectCases(loadCases(split), options.plan.cases).map((c) => ({
      case: c,
      split,
    })),
  );
}

/** Runs `tasks` with at most `limit` at a time. */
async function pool<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>,
) {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.min(limit, queue.length) },
    async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        await work(item);
      }
    },
  );
  await Promise.all(workers);
}

/** The prompt hashes and sizes of a spec, by transport. */
export function promptFingerprint(
  spec: GenerativeUIPromptSpec | undefined,
  transports: Transport[],
) {
  const prompts = renderedPrompts(spec);
  const hashes: RunRecord["promptHashes"] = {};
  const sizes: RunRecord["promptSizes"] = {};
  for (const t of transports) {
    hashes[t] = shortHash(prompts[t]);
    sizes[t] = Math.ceil(prompts[t].length / 4);
  }
  return { hashes, sizes };
}

/** The estimated cost of a whole run. */
export function estimateRun(
  options: Pick<RunOptions, "config" | "plan" | "spec"> & { caseCount: number },
) {
  const { sizes } = promptFingerprint(options.spec, options.plan.transports);
  let total = 0;
  for (const entry of options.plan.models) {
    for (const t of options.plan.transports) {
      total +=
        options.caseCount *
        options.plan.samples *
        estimateSampleCost(
          options.config,
          entry.model,
          options.plan.judge,
          sizes[t] ?? 0,
        );
    }
  }
  return total;
}

/**
 * Runs every case × model × transport × sample of the plan, scores each
 * sample (code tiers, then the judge), and writes run.json and one
 * samples.jsonl line per sample as it goes. Stops before a sample that
 * would take the run over its budget, and marks the run `stopped: "budget"`.
 */
export async function runEval(options: RunOptions): Promise<RunRecord> {
  const { config, plan } = options;
  const root = options.root ?? RESULTS_DIR;
  requireKey([...plan.models.map((m) => m.model), plan.judge]);
  const cases = casesOf(options);
  const spec = options.spec;
  const { hashes, sizes } = promptFingerprint(spec, plan.transports);
  const unknownDescriptions = spec ? catalogFor(spec).unknownDescriptions : [];
  const estimatedCostUsd = estimateRun({
    config,
    plan,
    spec,
    caseCount: cases.length,
  });
  const run: RunRecord = {
    id: newRunId(),
    kind: options.kind ?? "run",
    startedAt: new Date().toISOString(),
    ...gitState(),
    promptHashes: hashes,
    promptSizes: sizes,
    ...(options.specFile ? { spec: options.specFile } : {}),
    ...(unknownDescriptions.length > 0 ? { unknownDescriptions } : {}),
    preset: plan.preset,
    models: plan.models.map(({ id, model, provider }) => ({
      id,
      model,
      ...(provider ? { provider } : {}),
    })),
    transports: plan.transports,
    split: options.split,
    samplesPerCase: plan.samples,
    judge: plan.judge,
    budgetUsd: options.budgetUsd,
    estimatedCostUsd,
    totals: { samples: 0, costUsd: 0 },
  };
  writeRun(run, root);

  const tasks: Task[] = [];
  for (const { case: c, split } of cases) {
    for (const entry of plan.models) {
      for (const transport of plan.transports) {
        for (let sample = 0; sample < plan.samples; sample++) {
          tasks.push({ case: c, split, entry, transport, sample });
        }
      }
    }
  }

  const judgeModel = createLanguageModel({ model: plan.judge });
  const checker = new RenderChecker();
  let reserved = 0;
  let done = 0;
  try {
    await pool(tasks, config.concurrency, async (task) => {
      // Reserve the worst case, not the typical one: replies and judge
      // calls are capped, so this bound holds.
      const estimate = worstSampleCost(
        config,
        task.entry.model,
        plan.judge,
        sizes[task.transport] ?? 0,
        task.entry.params?.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
      );
      if (
        run.stopped ||
        run.totals.costUsd + reserved + estimate > options.budgetUsd
      ) {
        run.stopped = "budget";
        return;
      }
      reserved += estimate;
      try {
        const sample = await runTask(task, {
          config,
          plan,
          spec,
          judgeModel,
          checker,
        });
        appendSample(run.id, sample, root);
        run.totals.samples++;
        run.totals.costUsd += sample.costUsd + sample.judgeCostUsd;
        options.onProgress?.(++done, tasks.length, sample);
      } finally {
        reserved -= estimate;
      }
    });
  } finally {
    await checker.close();
  }
  run.finishedAt = new Date().toISOString();
  writeRun(run, root);
  return run;
}

/** Runs, checks, scores and judges one sample. */
async function runTask(
  task: Task,
  ctx: {
    config: EvalConfig;
    plan: ResolvedPlan;
    spec?: GenerativeUIPromptSpec;
    judgeModel: ReturnType<typeof createLanguageModel>;
    checker: RenderChecker;
  },
): Promise<SampleRecord> {
  const meta: CallMeta = {};
  const model = createLanguageModel(task.entry, (m) => Object.assign(meta, m));
  const out = await runSample({
    case: task.case,
    transport: task.transport,
    entry: task.entry,
    model,
    spec: ctx.spec,
  });
  let checks: Awaited<ReturnType<RenderChecker["check"]>> = [];
  try {
    checks = await ctx.checker.check(out.surfaces);
  } catch (error) {
    out.parseErrors.push(`render check failed: ${(error as Error).message}`);
  }
  const code = scoreCode(task.case, out, checks);
  const verdict = await judgeSample(ctx.judgeModel, task.case, out);
  const judgeScore = verdict.judgement.score;
  const qualityScore = verdict.quality.score;
  const judgementReasons = [...code.judgement.reasons];
  if (judgeScore !== null && judgeScore < JUDGE_PASS) {
    judgementReasons.push(`judge: ${verdict.judgement.reason}`);
  }
  return {
    case: task.case.id,
    split: task.split,
    tags: task.case.tags,
    model: task.entry.id,
    modelName: task.entry.model,
    ...(meta.host ? { host: meta.host } : {}),
    transport: task.transport,
    sample: task.sample,
    tiers: {
      validity: code.validity,
      fidelity: code.fidelity,
      judgement: {
        // The code part decides a fail; a pass also needs the judge, so a
        // failed judge leaves it ungraded instead of counting as a pass.
        pass:
          judgementReasons.length > 0
            ? false
            : judgeScore === null
              ? null
              : true,
        reasons: judgementReasons,
        score: judgeScore,
      },
      quality: {
        pass: qualityScore === null ? null : qualityScore >= JUDGE_PASS,
        reasons:
          qualityScore !== null && qualityScore < JUDGE_PASS
            ? [`judge: ${verdict.quality.reason}`]
            : [],
        score: qualityScore,
      },
    },
    promptTokens: out.promptTokens,
    outputTokens: out.outputTokens,
    costUsd:
      meta.costUsd ??
      costOf(ctx.config, task.entry.model, out.promptTokens, out.outputTokens),
    judgeCostUsd: costOf(
      ctx.config,
      ctx.plan.judge,
      verdict.costTokens.input,
      verdict.costTokens.output,
    ),
    components: [...new Set(checks.flatMap((c) => c.components))],
    surfaces: out.surfaces.length,
    output: {
      text: out.text,
      toolCalls: out.toolCalls,
      parseErrors: out.parseErrors,
      ...(out.error ? { error: out.error } : {}),
    },
  };
}
