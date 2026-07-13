/**
 * aggregate-build-results.ts — run in the `aggregate-build-results` job
 * of showcase_build.yml AFTER actions/download-artifact has extracted the
 * per-slot artifacts. Multiple matches use
 * $INPUT_DIR/build-result-<dispatch_name>/result.json; a single match from
 * download-artifact@v5+ uses $INPUT_DIR/result.json.
 *
 * Responsibilities:
 *   1. Read every per-slot result.json under $INPUT_DIR.
 *   2. Merge via mergeBuildResultFiles (single source of contract truth).
 *   3. Write the canonical $OUTPUT_DIR/results.json (uploaded as the
 *      `build-results` artifact for cross-workflow consumption).
 *   4. Append `results=...` and `any_success=true|false` to $GITHUB_OUTPUT
 *      so the redeploy-staging guard and the deploy workflow can read
 *      them as job-level outputs.
 *
 * No GitHub API calls. No job-name parsing. Pure filesystem aggregation.
 *
 * Testability: env reading lives in the CLI entrypoint at the bottom;
 * the core is exported as `run({inputDir, outputDir, githubOutput})` so
 * tests can drive it with temp dirs.
 */
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeBuildResultFiles, successSet } from "./lib/build-outputs";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`aggregate-build-results: $${name} is required`);
  }
  return v;
}

export interface RunOptions {
  inputDir: string;
  outputDir: string;
  githubOutput: string;
}

function readErrorReason(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code);
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read a single per-slot result.json. On failure (missing file, permission
 * error, etc.), wraps the error with the offending slot directory so the
 * job log identifies WHICH slot was the culprit instead of dumping a raw
 * ENOENT against a long opaque path. We refuse to silently skip the slot —
 * a missing per-slot artifact is a real defect (the build job's artifact
 * upload step is broken or the matrix collapsed) and silently dropping it
 * would let a failed build masquerade as "not present" downstream.
 */
function readSlotPayload(inputDir: string, slotDirName: string): string {
  const path = join(inputDir, slotDirName, "result.json");
  try {
    return readFileSync(path, "utf-8");
  } catch (e) {
    throw new Error(
      `aggregate-build-results: ${slotDirName} is missing result.json (${readErrorReason(e)})`,
      { cause: e },
    );
  }
}

/**
 * Emit the per-job outputs to $GITHUB_OUTPUT. `results` uses the
 * multi-line heredoc form, which is the GHA-recommended encoding for
 * any value that might contain (or grow to contain) a newline — most
 * importantly, it survives pretty-printed JSON or other multi-line
 * payloads without truncation. A random delimiter token prevents
 * collision with embedded payloads. `any_success` stays a plain
 * key=value line since the value is a fixed boolean literal.
 *
 * Written BEFORE results.json so a $GITHUB_OUTPUT write failure
 * (e.g. the file is missing / not writable) aborts before we publish
 * an artifact the downstream jobs would consume without seeing the
 * matching job output.
 */
function writeGithubOutput(
  githubOutput: string,
  resultsJson: string,
  anySuccess: boolean,
): void {
  const delimiter = `EOF_${randomBytes(8).toString("hex")}`;
  appendFileSync(
    githubOutput,
    `results<<${delimiter}\n${resultsJson}\n${delimiter}\n`,
  );
  appendFileSync(
    githubOutput,
    `any_success=${anySuccess ? "true" : "false"}\n`,
  );
}

/**
 * Attempt to read result.json directly from the root of inputDir. Used as a
 * single-artifact fallback when actions/download-artifact@v5+ is used: if the
 * glob pattern matches exactly one artifact the contents land flat in $path
 * instead of $path/$artifact-name/. Throws the canonical "broken download"
 * error (same message as the zero-slot check) when no result.json exists at
 * the root either — that means the download truly produced nothing.
 */
function readSingleFallbackPayload(inputDir: string): string {
  const path = join(inputDir, "result.json");
  try {
    return readFileSync(path, "utf-8");
  } catch (e) {
    throw new Error(
      `aggregate-build-results: found 0 build-result-* slot dirs in ${inputDir} and ` +
        `root-level result.json could not be read (${readErrorReason(e)}) — the per-slot ` +
        `artifact download produced no usable result; this indicates a broken download, ` +
        `not an empty build set (the job only runs when >=1 service was scheduled).`,
      { cause: e },
    );
  }
}

export function run(opts: RunOptions): void {
  const { inputDir, outputDir, githubOutput } = opts;

  mkdirSync(outputDir, { recursive: true });

  const slotDirs = readdirSync(inputDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("build-result-"))
    .map((d) => d.name);

  // The aggregator job is gated upstream on `has_changes == 'true'`, so the
  // build matrix is guaranteed non-empty by the time we run. A zero-slot
  // input dir therefore signals a BROKEN per-slot artifact download (e.g.
  // expired artifacts, wrong run-id, transient download error) — NOT a
  // legitimate empty build set. Silently emitting `any_success=false` with
  // `results=[]` would be indistinguishable from "all builds failed" and
  // would push deploy down the false-green path where it probes the full
  // service set against stale `:latest`. Fail loud instead.
  //
  // Exception: actions/download-artifact@v5+ changed the extraction behavior
  // for single-match patterns. When `pattern: build-result-*` matches exactly
  // ONE artifact, the artifact's files are placed directly in `$path` instead
  // of `$path/<artifact-name>/`. This means on runs where only one service
  // changed we find no `build-result-*` subdirectory but DO find a
  // `result.json` at the root of $INPUT_DIR. readSingleFallbackPayload handles
  // that case and re-raises the broken-download error when even that is absent.
  const payloads: string[] =
    slotDirs.length > 0
      ? slotDirs.map((name) => readSlotPayload(inputDir, name))
      : [readSingleFallbackPayload(inputDir)];

  const merged = mergeBuildResultFiles(payloads);
  const resultsJson = JSON.stringify(merged);
  const anySuccess = successSet(merged).length > 0;

  // Emit $GITHUB_OUTPUT first so a write failure here doesn't leave a
  // published results.json artifact without a matching job output.
  writeGithubOutput(githubOutput, resultsJson, anySuccess);

  // Trailing newline for consistency with conventional JSON-on-disk
  // tooling (POSIX line, diff-friendly).
  writeFileSync(join(outputDir, "results.json"), `${resultsJson}\n`);
}

function main(): void {
  run({
    inputDir: requireEnv("INPUT_DIR"),
    outputDir: requireEnv("OUTPUT_DIR"),
    githubOutput: requireEnv("GITHUB_OUTPUT"),
  });
}

// CLI entrypoint: only run main() when invoked directly (e.g. `tsx
// aggregate-build-results.ts`), NOT when imported by a test. Comparing
// `import.meta.url` against process.argv[1] is the standard ESM idiom.
const invokedDirectly = (() => {
  try {
    return (
      typeof process !== "undefined" &&
      Array.isArray(process.argv) &&
      process.argv[1] === fileURLToPath(import.meta.url)
    );
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main();
}
