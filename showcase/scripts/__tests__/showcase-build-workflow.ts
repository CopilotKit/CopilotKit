import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Shared read-side scaffolding for the tests that assert against the LIVE
// `.github/workflows/showcase_build.yml`.
//
// Two suites (advance-latest-tag.test.ts, redeploy-guard.test.ts) previously
// carried byte-identical copies of the path constant and the parse helper, and
// each re-read + re-parsed the 1,700-line YAML on EVERY helper call. The parse
// is memoized here: the workflow cannot change mid-run, so one parse per test
// process is both correct and ~2 orders of magnitude cheaper.
// ---------------------------------------------------------------------------

export const WORKFLOW_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".github",
  "workflows",
  "showcase_build.yml",
);

export interface WorkflowStep {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}

export interface WorkflowJob {
  name?: string;
  if?: string;
  concurrency?: unknown;
  permissions?: Record<string, string> | string;
  steps?: WorkflowStep[];
}

export interface WorkflowDoc {
  concurrency?: unknown;
  permissions?: Record<string, string> | string;
  jobs: Record<string, WorkflowJob>;
}

let cached: WorkflowDoc | undefined;

/** The parsed workflow. Parsed once per process, then reused. */
export function readWorkflow(): WorkflowDoc {
  cached ??= parseYaml(readFileSync(WORKFLOW_PATH, "utf8")) as WorkflowDoc;
  return cached;
}

export function jobOf(jobId: string): WorkflowJob {
  const job = readWorkflow().jobs[jobId];
  if (!job) throw new Error(`Job '${jobId}' not found in ${WORKFLOW_PATH}`);
  return job;
}

export function stepsOf(jobId: string): WorkflowStep[] {
  const job = jobOf(jobId);
  if (!Array.isArray(job.steps)) {
    throw new Error(`Job '${jobId}' has no steps`);
  }
  return job.steps;
}

/** Every step of every job, flattened — for workflow-wide bans. */
export function allSteps(): Array<{ jobId: string; step: WorkflowStep }> {
  const out: Array<{ jobId: string; step: WorkflowStep }> = [];
  for (const [jobId, job] of Object.entries(readWorkflow().jobs)) {
    for (const step of job.steps ?? []) out.push({ jobId, step });
  }
  return out;
}

/** The single step in `jobId` with the given `id:`. */
export function stepById(jobId: string, stepId: string): WorkflowStep {
  const step = stepsOf(jobId).find((s) => s.id === stepId);
  if (!step) throw new Error(`Job '${jobId}' has no step with id '${stepId}'`);
  return step;
}

/**
 * Pull a single-quoted shell heredoc-style JSON literal (`NAME='[...]'`) out of
 * a step's `run:` script and parse it.
 *
 * The service and starter matrices are defined as inline JSON inside
 * `detect-changes` / `detect-starter-changes`. Reading them from the workflow
 * rather than restating them in a fixture is what keeps the intersection tests
 * joined to the real fleet — a new `skip_build` slot is picked up automatically.
 */
export function parseJsonLiteralFromRun<T>(run: string, name: string): T {
  const match = run.match(new RegExp(`${name}='([\\s\\S]*?)'`));
  if (!match)
    throw new Error(`No ${name}='…' literal found in the step script`);
  return JSON.parse(match[1]) as T;
}

export interface ServiceSlot {
  dispatch_name: string;
  image: string;
  skip_build?: boolean;
}

export interface StarterSlot {
  slug: string;
  image: string;
}

/** The live showcase service matrix (`ALL_SERVICES` in `detect-changes`). */
export function allServiceSlots(): ServiceSlot[] {
  return parseJsonLiteralFromRun<ServiceSlot[]>(
    stepById("detect-changes", "build-matrix").run ?? "",
    "ALL_SERVICES",
  );
}

/** The live starter matrix (`ALL_STARTERS` in `detect-starter-changes`). */
export function allStarterSlots(): StarterSlot[] {
  return parseJsonLiteralFromRun<StarterSlot[]>(
    stepById("detect-starter-changes", "starter-matrix").run ?? "",
    "ALL_STARTERS",
  );
}
