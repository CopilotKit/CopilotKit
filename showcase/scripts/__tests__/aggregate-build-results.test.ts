/**
 * aggregate-build-results.test.ts — covers the per-slot aggregator that
 * runs in the `aggregate-build-results` job of showcase_build.yml.
 *
 * The script's `run({inputDir, outputDir, githubOutput})` entrypoint is
 * exercised directly with temp dirs (so we never touch tracked files or
 * spawn subprocesses). We verify:
 *   1. empty INPUT_DIR → results.json = `[]`, any_success=false, no throw
 *   2. build-result-<x> dir missing result.json → throws naming the slot
 *   3. non-`build-result-*` dirs are ignored
 *   4. mixed success/failure → correct merged array + any_success=true
 *   5. GITHUB_OUTPUT receives heredoc-form `results` block + any_success
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../aggregate-build-results";

function makeSlot(
  inputDir: string,
  service: string,
  status: "success" | "failure" | "skipped",
): void {
  const dir = join(inputDir, `build-result-${service}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "result.json"), JSON.stringify({ service, status }));
}

describe("aggregate-build-results.run", () => {
  let inputDir: string;
  let outputDir: string;
  let githubOutput: string;

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), "agg-build-"));
    inputDir = join(base, "in");
    outputDir = join(base, "out");
    githubOutput = join(base, "gh_output");
    mkdirSync(inputDir, { recursive: true });
    // OUTPUT_DIR intentionally NOT pre-created — run() must mkdir -p.
    writeFileSync(githubOutput, "");
  });

  afterEach(() => {
    // Temp dirs are under os.tmpdir(); OS reaps them. No tracked files
    // touched, so no cleanup needed.
  });

  it("empty INPUT_DIR → throws (broken artifact download — the aggregator only runs when >=1 service was scheduled)", () => {
    // The aggregator is gated on `has_changes == 'true'` upstream, so the
    // matrix is guaranteed non-empty by the time we run. A zero-slot input
    // dir therefore means the per-slot artifact download produced nothing
    // (broken download, expired artifacts, mis-scoped run-id). Silently
    // emitting `any_success=false` with `results=[]` is indistinguishable
    // from "all builds failed" — that's a false-green path because the
    // deploy workflow then has no success set to intersect against and
    // falls back to probing the full service set against stale :latest.
    // We refuse the ambiguity and fail loud instead.
    expect(() => run({ inputDir, outputDir, githubOutput })).toThrow(
      /aggregate-build-results: found 0 build-result-\* slot dirs/,
    );
  });

  it("throws naming the slot when build-result-<x>/result.json is missing", () => {
    const slotDir = join(inputDir, "build-result-orphan");
    mkdirSync(slotDir, { recursive: true });
    // Note: NO result.json written.

    expect(() => run({ inputDir, outputDir, githubOutput })).toThrow(
      /aggregate-build-results: build-result-orphan is missing result\.json/,
    );
  });

  it("ignores directories that do not match build-result-*", () => {
    mkdirSync(join(inputDir, "some-other-artifact"), { recursive: true });
    writeFileSync(
      join(inputDir, "some-other-artifact", "result.json"),
      JSON.stringify({ service: "noise", status: "success" }),
    );
    // A file (not a directory) at top level should also be ignored.
    writeFileSync(join(inputDir, "build-result-not-a-dir"), "garbage");

    makeSlot(inputDir, "real", "success");

    run({ inputDir, outputDir, githubOutput });

    const results = JSON.parse(
      readFileSync(join(outputDir, "results.json"), "utf-8"),
    );
    expect(results).toEqual([{ service: "real", status: "success" }]);
  });

  it("merges mixed success/failure correctly and sets any_success=true", () => {
    makeSlot(inputDir, "alpha", "success");
    makeSlot(inputDir, "beta", "failure");
    makeSlot(inputDir, "gamma", "skipped");

    run({ inputDir, outputDir, githubOutput });

    const results = JSON.parse(
      readFileSync(join(outputDir, "results.json"), "utf-8"),
    );
    expect(results).toHaveLength(3);
    const byName = new Map<string, string>(
      (results as Array<{ service: string; status: string }>).map((r) => [
        r.service,
        r.status,
      ]),
    );
    expect(byName.get("alpha")).toBe("success");
    expect(byName.get("beta")).toBe("failure");
    expect(byName.get("gamma")).toBe("skipped");

    const gh = readFileSync(githubOutput, "utf-8");
    expect(gh).toContain("any_success=true");
  });

  it("writes results to GITHUB_OUTPUT in multi-line heredoc form", () => {
    makeSlot(inputDir, "alpha", "success");
    makeSlot(inputDir, "beta", "failure");

    run({ inputDir, outputDir, githubOutput });

    const gh = readFileSync(githubOutput, "utf-8");

    // The heredoc form is:
    //   results<<EOF
    //   <json>
    //   EOF
    // The delimiter token is implementation-defined but must match on
    // both sides (GitHub Actions convention; commonly "EOF" or a unique
    // token to avoid collision with embedded payloads).
    const heredocRe = /results<<(\S+)\n([\s\S]*?)\n\1\n/;
    const match = gh.match(heredocRe);
    expect(match).not.toBeNull();
    if (!match) return;
    const [, , jsonBody] = match;
    const parsed = JSON.parse(jsonBody);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);

    // any_success line is still a plain key=value.
    expect(gh).toMatch(/any_success=true\n/);
  });

  it("results.json has a trailing newline", () => {
    makeSlot(inputDir, "alpha", "success");

    run({ inputDir, outputDir, githubOutput });

    const raw = readFileSync(join(outputDir, "results.json"), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
  });
});
