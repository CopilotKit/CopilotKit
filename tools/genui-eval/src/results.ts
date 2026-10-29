import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import type { Split } from "./cases";
import type { Transport } from "./config";

/** Where runs are written: results/ next to the tool, or $GENUI_EVAL_RESULTS. */
export const RESULTS_DIR = process.env.GENUI_EVAL_RESULTS
  ? `${process.env.GENUI_EVAL_RESULTS.replace(/\/$/, "")}/`
  : fileURLToPath(new URL("../results/", import.meta.url));

/** The four tiers, in order of importance. */
export const TIERS = ["validity", "fidelity", "judgement", "quality"] as const;
export type Tier = (typeof TIERS)[number];

/** One tier of one sample. `pass: null` when it could not be graded (the judge failed). */
export interface TierRecord {
  pass: boolean | null;
  reasons: string[];
  /** The judge's score, for judgement and quality. */
  score?: number | null;
}

/** One line of samples.jsonl. */
export interface SampleRecord {
  case: string;
  split: Split;
  tags: string[];
  /** The model id of the config, e.g. "claude". */
  model: string;
  /** The model string, e.g. "anthropic/claude-sonnet-4.5". */
  modelName: string;
  /** The host that answered (OpenRouter). */
  host?: string;
  /** Where the model call was captured (the codex backend). */
  log?: string;
  /** Fence lines that were repaired before parsing (a run with `repair`). */
  repairedLines?: number;
  transport: Transport;
  sample: number;
  tiers: Record<Tier, TierRecord>;
  promptTokens: number;
  outputTokens: number;
  /** Cost of the model call. */
  costUsd: number;
  /** Cost of judging it. */
  judgeCostUsd: number;
  /** Components the reply used. */
  components: string[];
  /** Number of surfaces. */
  surfaces: number;
  /** The reply, for `failures`. */
  output: {
    text: string;
    toolCalls: unknown[];
    parseErrors: string[];
    error?: string;
  };
}

/** run.json */
export interface RunRecord {
  id: string;
  kind: "run" | "optimize-candidate";
  startedAt: string;
  finishedAt?: string;
  gitSha: string;
  /** A hash of the uncommitted changes, when there are any. */
  dirtyHash?: string;
  /** A short hash of each rendered system prompt, by transport. */
  promptHashes: Partial<Record<Transport, string>>;
  /** Prompt tokens of each rendered system prompt, by transport (estimate: characters / 4). */
  promptSizes: Partial<Record<Transport, number>>;
  /** A spec file, when the run used one. */
  spec?: string;
  /** True when broken fence lines were repaired before parsing. */
  repair?: boolean;
  /** Description overrides that name no component or prop. */
  unknownDescriptions?: string[];
  preset: string;
  models: Array<{ id: string; model: string; provider?: string }>;
  transports: Transport[];
  split: Split | "both";
  samplesPerCase: number;
  judge: string;
  budgetUsd: number;
  estimatedCostUsd: number;
  /**
   * Set when the run stopped early: before a sample the budget could not
   * cover, or when the provider refused calls for lack of credit or
   * because the call was not signed in.
   */
  stopped?: "budget" | "credits" | "unauthorized";
  totals: { samples: number; costUsd: number };
}

export function runDir(id: string, root = RESULTS_DIR) {
  return `${root}${id}/`;
}

/** A sortable run id: the start time plus a short random part. */
export function newRunId(now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

export function writeRun(run: RunRecord, root = RESULTS_DIR) {
  const dir = runDir(run.id, root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}run.json`, `${JSON.stringify(run, null, 2)}\n`);
}

export function appendSample(
  id: string,
  sample: SampleRecord,
  root = RESULTS_DIR,
) {
  const dir = runDir(id, root);
  mkdirSync(dir, { recursive: true });
  appendFileSync(`${dir}samples.jsonl`, `${JSON.stringify(sample)}\n`);
}

/** Reads a run and its samples. `id` may be "latest". */
export function readRun(
  id: string,
  root = RESULTS_DIR,
): { run: RunRecord; samples: SampleRecord[] } {
  const resolved = id === "latest" ? latestRunId(root) : id;
  if (!resolved) throw new Error(`No runs in ${root}`);
  const dir = runDir(resolved, root);
  if (!existsSync(`${dir}run.json`))
    throw new Error(`No run "${resolved}" in ${root}`);
  const run = JSON.parse(readFileSync(`${dir}run.json`, "utf8")) as RunRecord;
  const file = `${dir}samples.jsonl`;
  const samples = existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as SampleRecord)
    : [];
  return { run, samples };
}

/** The newest plain run (not an optimizer candidate). */
export function latestRunId(root = RESULTS_DIR): string | undefined {
  if (!existsSync(root)) return undefined;
  // By the recorded start time: ids of runs started in the same second do not sort.
  return readdirSync(root)
    .filter((name) => existsSync(`${root}${name}/run.json`))
    .map(
      (name) =>
        JSON.parse(
          readFileSync(`${root}${name}/run.json`, "utf8"),
        ) as RunRecord,
    )
    .filter((run) => run.kind === "run")
    .sort(
      (a, b) =>
        a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id),
    )
    .at(-1)?.id;
}
