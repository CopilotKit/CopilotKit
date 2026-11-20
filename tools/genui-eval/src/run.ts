import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import type { GenerativeUIPromptSpec } from "@copilotkit/shared";
import { caseContext, loadCases, selectCases } from "./cases";
import type { EvalCase, Split } from "./cases";
import type { EvalConfig, ModelEntry, ResolvedPlan, Transport } from "./config";
import {
  MAX_OUTPUT_TOKENS,
  costOf,
  estimateSampleCost,
  tokenBound,
  worstSampleCost,
} from "./cost";
import { catalogFor, renderedPrompts, runSample } from "./harness";
import { JUDGE_PASS, judgeSample } from "./judge";
import { isCodexModel, setCodexConcurrency } from "./codex";
import { referenceOutput } from "./reference";
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
  /**
   * Repair broken fence lines with jsonrepair before the client parses them
   * (an experiment: the client does not do this). Each sample counts its
   * repaired lines, so validity without repair stays readable.
   */
  repair?: boolean;
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

/**
 * The cases with the splits taken in turn (train, held-out, train, …), so a
 * run stopped by its budget does not lose the held-out cases first.
 */
export function interleaveSplits<T extends { split: Split }>(cases: T[]): T[] {
  const train = cases.filter((c) => c.split === "train");
  const heldout = cases.filter((c) => c.split === "heldout");
  const out: T[] = [];
  for (let i = 0; i < Math.max(train.length, heldout.length); i++) {
    if (i < train.length) out.push(train[i]);
    if (i < heldout.length) out.push(heldout[i]);
  }
  return out;
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
  /** Token upper bounds of each guide (its UTF-8 bytes), for the budget. */
  const bounds: Partial<Record<Transport, number>> = {};
  for (const t of transports) {
    hashes[t] = shortHash(prompts[t]);
    sizes[t] = Math.ceil(prompts[t].length / 4);
    bounds[t] = tokenBound(prompts[t]);
  }
  return { hashes, sizes, bounds };
}

/**
 * Why a run error stops the run, when it says nothing about the model: the
 * provider is out of credit (OpenRouter's 402, a codex usage limit), or the
 * call was not signed in (401).
 */
export function providerStop(
  reason: string,
): "credits" | "unauthorized" | undefined {
  if (!reason.startsWith("run error:")) return undefined;
  if (
    /available credits|insufficient credits|more credits|payment required|\b402\b|usage limit/i.test(
      reason,
    )
  ) {
    return "credits";
  }
  if (/\b401\b|unauthorized|not signed in/i.test(reason)) return "unauthorized";
  return undefined;
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
  const { hashes, sizes, bounds } = promptFingerprint(spec, plan.transports);
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
    ...(options.repair ? { repair: true } : {}),
    ...(unknownDescriptions.length > 0 ? { unknownDescriptions } : {}),
    preset: plan.preset,
    models: plan.models.map(({ id, model, provider, params }) => ({
      id,
      model,
      ...(provider ? { provider } : {}),
      params: {
        ...params,
        maxOutputTokens: params?.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
      },
    })),
    validityMode: "raw",
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
  for (const { case: c, split } of interleaveSplits(cases)) {
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
  // Counted apart from `reserved`: money sums leave float remainders.
  let inFlight = 0;
  let done = 0;
  // Resolves when an in-flight sample finishes and its reservation is freed.
  let settled: () => void = () => {};
  let nextSettle = new Promise<void>((resolve) => (settled = resolve));
  try {
    setCodexConcurrency(config.codexConcurrency);
    // Enough samples in flight to keep every codex slot busy.
    const usesCodex = [...plan.models.map((m) => m.model), plan.judge].some(
      isCodexModel,
    );
    const parallel = usesCodex
      ? Math.max(config.concurrency, config.codexConcurrency)
      : config.concurrency;
    await pool(tasks, parallel, async (task) => {
      // Reserve the worst case, not the typical one: the guide plus the
      // whole conversation (with a margin), the capped reply and every
      // judge attempt. Replies and judge calls are capped, so this holds.
      const conversation = [
        task.case.message,
        ...(task.case.history ?? []).map((h) => h.content),
        ...caseContext(task.case).map((entry) => entry.value),
      ].join("\n");
      const estimate = worstSampleCost(
        config,
        task.entry.model,
        plan.judge,
        // Upper bounds: the guide and the conversation in bytes, plus room for
        // the agent's own system text and tool schemas.
        (bounds[task.transport] ?? 0) + tokenBound(conversation) + 4000,
        task.entry.params?.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
      );
      // While other samples hold reservations, wait for them: what they do
      // not spend comes back. Stop only when nothing is in flight.
      while (
        !run.stopped &&
        run.totals.costUsd + reserved + estimate > options.budgetUsd
      ) {
        if (inFlight === 0) {
          run.stopped = "budget";
          break;
        }
        await nextSettle;
      }
      if (run.stopped) return;
      reserved += estimate;
      inFlight++;
      try {
        const { sample, stop } = await runTask(task, {
          config,
          plan,
          spec,
          repair: options.repair,
          judgeModel,
          checker,
        });
        // A provider (the model's or the judge's) out of credit or not signed
        // in says nothing about the model: stop the run and keep the sample
        // out, instead of scoring it as a failure.
        if (stop) {
          run.stopped = stop;
          return;
        }
        appendSample(run.id, sample, root);
        run.totals.samples++;
        run.totals.costUsd += sample.costUsd + sample.judgeCostUsd;
        options.onProgress?.(++done, tasks.length, sample);
      } finally {
        reserved -= estimate;
        inFlight--;
        if (inFlight === 0) reserved = 0;
        const wake = settled;
        nextSettle = new Promise<void>((resolve) => (settled = resolve));
        wake();
      }
    });
  } finally {
    await checker.close();
  }
  run.finishedAt = new Date().toISOString();
  writeRun(run, root);
  return run;
}

/** Runs, checks, scores and judges one sample, and says whether its provider stops the run. */
async function runTask(
  task: Task,
  ctx: {
    config: EvalConfig;
    plan: ResolvedPlan;
    spec?: GenerativeUIPromptSpec;
    repair?: boolean;
    judgeModel: ReturnType<typeof createLanguageModel>;
    checker: RenderChecker;
  },
): Promise<{
  sample: SampleRecord;
  stop?: ReturnType<typeof providerStop>;
}> {
  const meta: CallMeta = {};
  const model = createLanguageModel(task.entry, (m) => Object.assign(meta, m));
  const out = await runSample({
    case: task.case,
    transport: task.transport,
    entry: task.entry,
    model,
    spec: ctx.spec,
    repair: ctx.repair,
  });
  let checks: Awaited<ReturnType<RenderChecker["check"]>> = [];
  try {
    checks = await ctx.checker.check(out.surfaces);
  } catch (error) {
    out.parseErrors.push(`render check failed: ${(error as Error).message}`);
  }
  const code = scoreCode(task.case, out, checks);
  const verdict = await judgeSample(
    ctx.judgeModel,
    task.case,
    out,
    checks,
    await referenceOutput(task.case),
  );
  const judgeScore = verdict.judgement.score;
  const qualityScore = verdict.quality.score;
  const judgementReasons = [...code.judgement.reasons];
  if (judgeScore !== null && judgeScore < JUDGE_PASS) {
    judgementReasons.push(`judge: ${verdict.judgement.reason}`);
  }
  const stop = [
    ...code.validity.reasons,
    ...(verdict.error ? [`run error: judge: ${verdict.error}`] : []),
  ]
    .map(providerStop)
    .find(Boolean);
  // A reply cut at the token cap says how long the model ran, not whether it
  // writes valid A2UI: validity is ungraded, like a failed judge.
  const validityReasons = out.cut
    ? ["cut at the output token cap", ...code.validity.reasons]
    : code.validity.reasons;
  const sample: SampleRecord = {
    case: task.case.id,
    split: task.split,
    tags: task.case.tags,
    model: task.entry.id,
    modelName: task.entry.model,
    ...(meta.host ? { host: meta.host } : {}),
    ...(meta.log ? { log: meta.log } : {}),
    ...(out.repairedLines?.length
      ? { repairedLines: out.repairedLines.length }
      : {}),
    ...(out.cut ? { cut: true } : {}),
    transport: task.transport,
    sample: task.sample,
    tiers: {
      validity: {
        pass: out.cut ? null : code.validity.pass,
        reasons: validityReasons,
      },
      fidelity: code.fidelity,
      judgement: {
        // Graded only when the judge graded: a failed judge leaves it
        // ungraded whatever the code part says, so a judge outage does not
        // keep the code fails and drop the passes. Otherwise the code part
        // decides a fail and a pass also needs the judge.
        pass: judgeScore === null ? null : judgementReasons.length === 0,
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
    recoveredValidity: {
      pass: out.cut ? null : code.recoveredValidity.pass,
      reasons: out.cut
        ? ["cut at the output token cap", ...code.recoveredValidity.reasons]
        : code.recoveredValidity.reasons,
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
    // Surfaces the user ends up with: a deleted one is not UI.
    surfaces: out.surfaces.length - checks.filter((c) => c.deleted).length,
    output: {
      text: out.text,
      toolCalls: out.toolCalls,
      parseErrors: out.parseErrors,
      ...(out.error ? { error: out.error } : {}),
    },
  };
  return { sample, ...(stop ? { stop } : {}) };
}
