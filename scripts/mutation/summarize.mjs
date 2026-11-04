#!/usr/bin/env node
// Turns Stryker JSON reports (mutation-testing-report-schema) into the
// markdown tables in scripts/mutation/baseline.md.
//
//   node scripts/mutation/summarize.mjs packages/core packages/runtime ...
//
// Reads <package>/reports/mutation/mutation.json for each package and prints
// markdown to stdout.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DETECTED = new Set(["Killed", "Timeout"]);
const UNDETECTED = new Set(["Survived", "NoCoverage"]);

/** Files with fewer valid mutants than this are left out of "worst files". */
export const MIN_MUTANTS_FOR_RANKING = 20;

/**
 * @typedef {{ detected: number, survived: number, noCoverage: number }} Counts
 */

/** @returns {Counts} */
function emptyCounts() {
  return { detected: 0, survived: 0, noCoverage: 0 };
}

/** @param {Counts} c */
export function mutationScore(c) {
  const valid = c.detected + c.survived + c.noCoverage;
  return valid === 0 ? null : (c.detected / valid) * 100;
}

/** @param {Counts} c */
export function coveredScore(c) {
  const covered = c.detected + c.survived;
  return covered === 0 ? null : (c.detected / covered) * 100;
}

/**
 * @param {Counts} c
 * @param {{ status: string }} mutant
 */
function count(c, mutant) {
  if (DETECTED.has(mutant.status)) c.detected++;
  else if (mutant.status === "Survived") c.survived++;
  else if (mutant.status === "NoCoverage") c.noCoverage++;
  // CompileError, RuntimeError and Ignored are not part of the score.
}

/**
 * Summarizes one Stryker report.
 *
 * A test file "kills nothing" when none of its tests is in any mutant's
 * `killedBy`. It is "redundant" when it kills mutants, but every one of them
 * is also killed by a test in another file, so deleting the file lets no
 * mutant survive. Both need `disableBail: true`, or `killedBy` holds only the
 * first test that failed.
 *
 * @param {any} report parsed mutation.json
 */
export function summarizeReport(report) {
  const total = emptyCounts();
  const files = [];
  /** @type {Map<string, string>} test id -> test file path */
  const testFileOf = new Map();
  /** @type {Map<string, { tests: number, kills: number, uniqueKills: number }>} */
  const testFiles = new Map();

  for (const [path, file] of Object.entries(report.testFiles ?? {})) {
    testFiles.set(path, { tests: file.tests.length, kills: 0, uniqueKills: 0 });
    for (const test of file.tests) testFileOf.set(test.id, path);
  }

  for (const [path, file] of Object.entries(report.files)) {
    const counts = emptyCounts();
    for (const mutant of file.mutants) {
      count(counts, mutant);
      count(total, mutant);
      if (!DETECTED.has(mutant.status)) continue;
      const killers = new Set(
        (mutant.killedBy ?? [])
          .map((id) => testFileOf.get(id))
          .filter((p) => p !== undefined),
      );
      for (const killer of killers) {
        const stats = testFiles.get(killer);
        stats.kills++;
        if (killers.size === 1) stats.uniqueKills++;
      }
    }
    files.push({ path, ...counts, score: mutationScore(counts) });
  }

  const ranked = files
    .filter(
      (f) => f.detected + f.survived + f.noCoverage >= MIN_MUTANTS_FOR_RANKING,
    )
    .sort(
      (a, b) =>
        a.score - b.score ||
        b.survived + b.noCoverage - (a.survived + a.noCoverage),
    );

  const tests = [...testFiles].map(([path, s]) => ({ path, ...s }));
  return {
    total,
    score: mutationScore(total),
    coveredScore: coveredScore(total),
    files,
    worstFiles: ranked,
    testFileCount: tests.length,
    zeroKillTests: tests
      .filter((t) => t.kills === 0)
      .sort((a, b) => a.path.localeCompare(b.path)),
    redundantTests: tests
      .filter((t) => t.kills > 0 && t.uniqueKills === 0)
      .sort((a, b) => b.kills - a.kills || a.path.localeCompare(b.path)),
  };
}

const pct = (n) => (n === null ? "n/a" : `${n.toFixed(1)}%`);

/** @param {{ name: string, summary: ReturnType<typeof summarizeReport> }[]} packages */
export function renderMarkdown(packages, { worst = 15 } = {}) {
  const out = [];
  out.push(
    "| Package | Score | Covered score | Detected | Survived | No coverage | Mutants |",
  );
  out.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const { name, summary: s } of packages) {
    const t = s.total;
    out.push(
      `| \`${name}\` | **${pct(s.score)}** | ${pct(s.coveredScore)} | ${t.detected} | ${t.survived} | ${t.noCoverage} | ${t.detected + t.survived + t.noCoverage} |`,
    );
  }

  for (const { name, summary: s } of packages) {
    out.push("", `### \`${name}\``, "");
    out.push(
      `Lowest-scoring files (at least ${MIN_MUTANTS_FOR_RANKING} mutants):`,
      "",
      "| File | Score | Survived | No coverage | Mutants |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const f of s.worstFiles.slice(0, worst)) {
      out.push(
        `| \`${f.path}\` | ${pct(f.score)} | ${f.survived} | ${f.noCoverage} | ${f.detected + f.survived + f.noCoverage} |`,
      );
    }
    out.push(
      "",
      `Test files that kill no mutant: **${s.zeroKillTests.length} of ${s.testFileCount}**.`,
    );
    if (s.zeroKillTests.length > 0) {
      out.push("");
      for (const t of s.zeroKillTests) {
        out.push(`- \`${t.path}\` (${t.tests} tests)`);
      }
    }
    out.push(
      "",
      `Test files whose every kill is also made by another file (deleting one alone lets no mutant survive): **${s.redundantTests.length} of ${s.testFileCount}**.`,
    );
    if (s.redundantTests.length > 0) {
      out.push(
        "",
        "<details><summary>List</summary>",
        "",
        ...s.redundantTests.map(
          (t) => `- \`${t.path}\` (${t.tests} tests, ${t.kills} kills)`,
        ),
        "",
        "</details>",
      );
    }
  }
  return out.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error("usage: summarize.mjs <package-dir>...");
    process.exit(1);
  }
  const packages = dirs.map((dir) => {
    const report = JSON.parse(
      readFileSync(join(dir, "reports/mutation/mutation.json"), "utf8"),
    );
    const { name } = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    );
    return { name, summary: summarizeReport(report) };
  });
  console.log(renderMarkdown(packages));
}
