/**
 * Eval baseline management — pull from the production harness, capture from
 * local eval runs, and persist/load from disk.
 *
 * The baseline is a snapshot of probe results that serves as the "expected"
 * state for regression detection. Two sources:
 *
 *   1. **harness-prod** — pulled from the live showcase-harness /api/probes
 *      endpoint via `pullBaseline`.
 *   2. **local-capture** — copied from the most recent local eval result
 *      file via `captureBaseline`.
 *
 * Results are keyed by integration slug (e.g. "mastra", "langgraph-python")
 * with a `_status` sub-key, matching the format produced by `collectResults`
 * in matrix.ts so that `computeRegressions` can compare them correctly.
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalBaseline {
  version: number;
  timestamp: string;
  source: "harness-prod" | "local-capture";
  branch: string;
  base: string;
  level: string;
  results: Record<
    string,
    Record<
      string,
      { status: string; total?: number; passed?: number; failed?: number }
    >
  >;
  summary: { total: number; pass: number; fail: number; skip: number };
}

interface HarnessServiceEntry {
  slug: string; // e.g. "e2e-deep:showcase-mastra"
  result: string; // "green" or "red"
  state: string; // "completed"
}

interface HarnessProbeEntry {
  id: string;
  kind: string;
  lastRun: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    state: string;
    summary: {
      total: number;
      passed: number;
      failed: number;
      services?: HarnessServiceEntry[];
    } | null;
  } | null;
}

export interface HarnessProbesResponse {
  probes: HarnessProbeEntry[];
}

// ---------------------------------------------------------------------------
// Pure transform
// ---------------------------------------------------------------------------

/**
 * Convert a harness /api/probes response into an EvalBaseline.
 *
 * Iterates each probe's `summary.services[]` to produce slug-keyed results
 * that match the format produced by `collectResults` in matrix.ts. Each
 * service slug has the format `<probeId>:showcase-<integrationSlug>` —
 * we extract the integration slug via `split(":showcase-")[1]`.
 *
 * When the same integration slug appears in multiple probes, the worst
 * status wins (if any probe shows red, the slug is "fail").
 *
 * Probes without `lastRun`, without `summary`, or without `services[]`
 * are skipped gracefully.
 */
export function transformHarnessResponse(
  response: HarnessProbesResponse,
): EvalBaseline {
  const results: EvalBaseline["results"] = {};
  let pass = 0;
  let fail = 0;

  for (const probe of response.probes) {
    if (!probe.lastRun) continue;
    if (!probe.lastRun.summary) continue;
    if (!probe.lastRun.summary.services) continue;

    for (const service of probe.lastRun.summary.services) {
      const integrationSlug = service.slug.split(":showcase-")[1];
      if (!integrationSlug) continue;

      const status = service.result === "green" ? "pass" : "fail";

      if (!results[integrationSlug]) {
        results[integrationSlug] = {
          _status: { status },
        };
        if (status === "pass") pass++;
        else fail++;
      }
      // If same slug appears in multiple probes, keep the worst status
      else if (
        status === "fail" &&
        results[integrationSlug]._status.status !== "fail"
      ) {
        results[integrationSlug]._status.status = "fail";
        pass--;
        fail++;
      }
    }
  }

  return {
    version: 1,
    timestamp: new Date().toISOString(),
    source: "harness-prod",
    branch: "",
    base: "",
    level: "deep",
    results,
    summary: { total: pass + fail, pass, fail, skip: 0 },
  };
}

// ---------------------------------------------------------------------------
// Network pull
// ---------------------------------------------------------------------------

const DEFAULT_HARNESS_URL =
  process.env["SHOWCASE_HARNESS_URL"] ??
  "https://showcase-harness-production.up.railway.app";

/**
 * Pull the current probe state from a live harness instance, transform it
 * into an EvalBaseline, and save to disk.
 */
export async function pullBaseline(
  harnessUrl: string = DEFAULT_HARNESS_URL,
  outputPath: string,
): Promise<EvalBaseline> {
  const url = `${harnessUrl.replace(/\/+$/, "")}/api/probes`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(
      `Harness fetch failed: ${res.status} ${res.statusText} (${url})`,
    );
  }
  const body = (await res.json()) as HarnessProbesResponse;
  const baseline = transformHarnessResponse(body);
  saveBaseline(baseline, outputPath);
  return baseline;
}

// ---------------------------------------------------------------------------
// Disk I/O
// ---------------------------------------------------------------------------

/**
 * Load a baseline from disk. Returns null when the file doesn't exist.
 */
export function loadBaseline(filePath: string): EvalBaseline | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as EvalBaseline;
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
}

/**
 * Write a baseline to disk as pretty-printed JSON.
 */
export function saveBaseline(baseline: EvalBaseline, filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(baseline, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Local capture
// ---------------------------------------------------------------------------

/**
 * Find the most recently modified .json file in `evalResultsDir`, read it
 * as an EvalBaseline, override `source` to "local-capture", and write it
 * to `baselinePath`.
 */
export function captureBaseline(
  evalResultsDir: string,
  baselinePath: string,
): void {
  const files = fs
    .readdirSync(evalResultsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const full = path.join(evalResultsDir, f);
      return { path: full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    throw new Error(
      `No .json files found in eval results dir: ${evalResultsDir}`,
    );
  }

  const raw = fs.readFileSync(files[0].path, "utf-8");
  const data = JSON.parse(raw) as EvalBaseline;
  data.source = "local-capture";

  saveBaseline(data, baselinePath);
}
