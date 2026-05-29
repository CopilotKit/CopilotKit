/**
 * aggregate-build-results.ts — run in the `aggregate-build-results` job
 * of showcase_build.yml AFTER actions/download-artifact has extracted
 * every per-slot `build-result-<dispatch_name>` artifact into
 * $INPUT_DIR/build-result-<dispatch_name>/result.json.
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
 */
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { mergeBuildResultFiles, successSet } from "./lib/build-outputs";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`aggregate-build-results: $${name} is required`);
  }
  return v;
}

function main(): void {
  const inDir = requireEnv("INPUT_DIR");
  const outDir = requireEnv("OUTPUT_DIR");
  const ghOutput = requireEnv("GITHUB_OUTPUT");

  mkdirSync(outDir, { recursive: true });

  const payloads = readdirSync(inDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("build-result-"))
    .map((d) => join(inDir, d.name, "result.json"))
    .map((p) => readFileSync(p, "utf-8"));

  const merged = mergeBuildResultFiles(payloads);
  writeFileSync(join(outDir, "results.json"), JSON.stringify(merged));

  const anySuccess = successSet(merged).length > 0 ? "true" : "false";
  appendFileSync(ghOutput, `results=${JSON.stringify(merged)}\n`);
  appendFileSync(ghOutput, `any_success=${anySuccess}\n`);
}

main();
