#!/usr/bin/env node
// Turns Stryker JSON reports (mutation-testing-report-schema) into the
// markdown tables in scripts/mutation/baseline.md, and lists every test that
// kills no mutant.
//
//   node scripts/mutation/summarize.mjs [--idle-out <file>]
//     [--idle-reasons <reason>,...] <package>...
//
// A <package> is a package folder. Its report is
// <folder>/reports/mutation/mutation.json. To merge the reports of a package
// that ran as shards, name them after `=`, separated by commas:
//
//   packages/react-core=a/mutation.json,b/mutation.json
//
// The summary goes to stdout. `--idle-out` also writes the list of tests that
// kill nothing, by name, to that file. `--idle-reasons` limits that list to
// some IDLE_REASONS keys.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const DETECTED = new Set(["Killed", "Timeout"]);
/** Mutants that count toward the score and that a test can run. */
const SCORED = new Set(["Killed", "Timeout", "Survived"]);

/** Files with fewer valid mutants than this are left out of "worst files". */
export const MIN_MUTANTS_FOR_RANKING = 20;

/**
 * Why a test kills no mutant. The order is the order of the idle-tests list.
 *
 * - `runs-code`: the test runs mutated code, and no mutant made it fail. This
 *   is the most likely rot. Check its assertions first.
 * - `timeout`: the test runs a mutant that ended in a timeout. Stryker does
 *   not record which test a timeout came from, so the test may have caught it.
 * - `no-code`: the test runs no mutated code in this package. It can test
 *   another package, types, module-level code (`ignoreStatic`) or a file that
 *   is not mutated. This is not proof of rot.
 */
export const IDLE_REASONS = {
  "runs-code":
    "runs mutated code, but no mutant made it fail. Most likely rot: check its assertions first.",
  timeout:
    "runs a mutant that ended in a timeout. Stryker does not record which test caused a timeout, so this test may have caught it.",
  "no-code":
    "runs no mutated code in this package. It may test another package, types, module-level code or an unmutated file. Not proof of rot.",
};

/**
 * `timedOut` is the part of `detected` that was a timeout, not a failing test.
 *
 * @typedef {{ detected: number, timedOut: number, survived: number, noCoverage: number }} Counts
 */

/** @returns {Counts} */
function emptyCounts() {
  return { detected: 0, timedOut: 0, survived: 0, noCoverage: 0 };
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
  if (mutant.status === "Timeout") c.timedOut++;
  else if (mutant.status === "Survived") c.survived++;
  else if (mutant.status === "NoCoverage") c.noCoverage++;
  // CompileError, RuntimeError and Ignored are not part of the score.
}

/**
 * Merges the reports of one package that ran as shards, each on different
 * source files. Every shard runs the full test suite, so a test that kills
 * nothing in one shard can kill mutants in another. Test ids are per run, so
 * tests are matched by file, name and line, and the mutants' `killedBy` and
 * `coveredBy` are rewritten to the merged ids.
 *
 * @param {any[]} reports parsed mutation.json files
 */
export function mergeReports(reports) {
  if (reports.length === 1) return reports[0];
  const files = {};
  const testFiles = {};
  /** @type {Map<string, string>} file + name + line -> merged id */
  const mergedId = new Map();

  for (const report of reports) {
    /** @type {Map<string, string>} id in this report -> merged id */
    const toMerged = new Map();
    for (const [path, file] of Object.entries(report.testFiles ?? {})) {
      testFiles[path] ??= { tests: [] };
      for (const test of file.tests) {
        const key = `${path}\0${test.name}\0${test.location?.start?.line}`;
        let id = mergedId.get(key);
        if (id === undefined) {
          id = String(mergedId.size);
          mergedId.set(key, id);
          testFiles[path].tests.push({ ...test, id });
        }
        toMerged.set(test.id, id);
      }
    }
    const remap = (ids) =>
      ids?.map((id) => toMerged.get(id)).filter((id) => id !== undefined);
    for (const [path, file] of Object.entries(report.files)) {
      if (path in files) {
        throw new Error(
          `${path} is in more than one report. Shards must mutate different files.`,
        );
      }
      files[path] = {
        ...file,
        mutants: file.mutants.map((m) => ({
          ...m,
          killedBy: remap(m.killedBy),
          coveredBy: remap(m.coveredBy),
        })),
      };
    }
  }
  return { files, testFiles };
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
 * A single test is "idle" when it kills no mutant. `idleTests` ranks test
 * files by how many of their tests are idle, and lists each idle test with
 * its line and an `IDLE_REASONS` key.
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
  /** @type {Set<string>} ids of tests that killed at least one mutant */
  const killingTests = new Set();
  /** @type {Set<string>} ids of tests that run at least one scored mutant */
  const runningTests = new Set();
  /** @type {Set<string>} ids of tests that run a mutant that timed out */
  const timeoutTests = new Set();

  for (const [path, file] of Object.entries(report.testFiles ?? {})) {
    testFiles.set(path, { tests: file.tests.length, kills: 0, uniqueKills: 0 });
    for (const test of file.tests) testFileOf.set(test.id, path);
  }

  for (const [path, file] of Object.entries(report.files)) {
    const counts = emptyCounts();
    for (const mutant of file.mutants) {
      count(counts, mutant);
      count(total, mutant);
      if (SCORED.has(mutant.status)) {
        for (const id of mutant.coveredBy ?? []) {
          runningTests.add(id);
          if (mutant.status === "Timeout") timeoutTests.add(id);
        }
      }
      if (!DETECTED.has(mutant.status)) continue;
      for (const id of mutant.killedBy ?? []) killingTests.add(id);
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

  /** @param {string} id */
  const reasonOf = (id) =>
    timeoutTests.has(id)
      ? "timeout"
      : runningTests.has(id)
        ? "runs-code"
        : "no-code";

  const tests = [...testFiles].map(([path, s]) => {
    const list = report.testFiles[path].tests
      .filter((t) => !killingTests.has(t.id))
      .map((t) => ({
        name: t.name,
        line: t.location?.start?.line ?? null,
        reason: reasonOf(t.id),
      }))
      .sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    return { path, ...s, idle: list.length, list };
  });

  const idleByReason = Object.fromEntries(
    Object.keys(IDLE_REASONS).map((r) => [r, 0]),
  );
  for (const t of tests) for (const i of t.list) idleByReason[i.reason]++;

  return {
    total,
    score: mutationScore(total),
    coveredScore: coveredScore(total),
    files,
    worstFiles: ranked,
    testFileCount: tests.length,
    testCount: tests.reduce((n, t) => n + t.tests, 0),
    idleTestCount: tests.reduce((n, t) => n + t.idle, 0),
    idleByReason,
    idleTests: tests
      .filter((t) => t.idle > 0)
      .sort((a, b) => b.idle - a.idle || a.path.localeCompare(b.path)),
    zeroKillTests: tests
      .filter((t) => t.kills === 0)
      .sort((a, b) => a.path.localeCompare(b.path)),
    redundantTests: tests
      .filter((t) => t.kills > 0 && t.uniqueKills === 0)
      .sort((a, b) => b.kills - a.kills || a.path.localeCompare(b.path)),
  };
}

const pct = (n) => (n === null ? "n/a" : `${n.toFixed(1)}%`);

/** Escapes text for a markdown table cell. */
const cell = (s) => String(s).replaceAll("|", "\\|").replaceAll("\n", " ");

/** @param {Record<string, number>} byReason */
const reasonCounts = (byReason) =>
  Object.entries(byReason)
    .map(([r, n]) => `\`${r}\` ${n}`)
    .join(", ");

/** @param {{ name: string, summary: ReturnType<typeof summarizeReport> }[]} packages */
export function renderMarkdown(packages, { worst = 15 } = {}) {
  const out = [];
  out.push(
    "| Package | Score | Covered score | Detected (of which timeouts) | Survived | No coverage | Mutants |",
  );
  out.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const { name, summary: s } of packages) {
    const t = s.total;
    out.push(
      `| \`${name}\` | **${pct(s.score)}** | ${pct(s.coveredScore)} | ${t.detected} (${t.timedOut}) | ${t.survived} | ${t.noCoverage} | ${t.detected + t.survived + t.noCoverage} |`,
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
      `Tests that kill no mutant: **${s.idleTestCount} of ${s.testCount}** (${reasonCounts(s.idleByReason)}). Test files with the most of them:`,
      "",
      "| Test file | Tests that kill nothing | Tests |",
      "| --- | --- | --- |",
      ...s.idleTests
        .slice(0, worst)
        .map((t) => `| \`${t.path}\` | ${t.idle} | ${t.tests} |`),
    );
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

/**
 * Every test that kills no mutant, by package and reason, most likely rot
 * first. Starts at `##` so it can be embedded under another heading.
 *
 * @param {{ name: string, summary: ReturnType<typeof summarizeReport> }[]} packages
 * @param {{ reasons?: string[] }} [options] only list these `IDLE_REASONS`
 */
export function renderIdleTests(
  packages,
  { reasons = Object.keys(IDLE_REASONS) } = {},
) {
  const out = [
    "Deleting one of these tests lets no mutant survive. Check the reason before you delete or rewrite a test:",
    "",
    ...reasons.map((r) => `- \`${r}\`: ${IDLE_REASONS[r]}`),
  ];
  for (const { name, summary: s } of packages) {
    out.push(
      "",
      `## \`${name}\`: ${s.idleTestCount} of ${s.testCount} tests kill nothing`,
      "",
      reasonCounts(s.idleByReason),
    );
    for (const reason of reasons) {
      const rows = s.idleTests.flatMap((t) =>
        t.list
          .filter((i) => i.reason === reason)
          .map((i) => `| \`${t.path}\` | ${i.line ?? ""} | ${cell(i.name)} |`),
      );
      if (rows.length === 0) continue;
      out.push(
        "",
        `### \`${reason}\` (${rows.length})`,
        "",
        "| Test file | Line | Test |",
        "| --- | --- | --- |",
        ...rows,
      );
    }
  }
  return out.join("\n") + "\n";
}

/**
 * Parses a `<package-dir>[=<report>,<report>...]` argument.
 *
 * @param {string} spec
 */
export function parsePackageSpec(spec) {
  const [dir, reports] = spec.split("=");
  return {
    dir,
    reports: reports
      ? reports.split(",").filter(Boolean)
      : [join(dir, "reports/mutation/mutation.json")],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({
    options: {
      "idle-out": { type: "string" },
      "idle-reasons": { type: "string" },
    },
    allowPositionals: true,
  });
  const reasons = values["idle-reasons"]?.split(",");
  const unknown = reasons?.filter((r) => !(r in IDLE_REASONS)) ?? [];
  if (positionals.length === 0 || unknown.length > 0) {
    if (unknown.length > 0) console.error(`unknown reason: ${unknown}`);
    console.error(
      "usage: summarize.mjs [--idle-out <file>] [--idle-reasons runs-code,timeout,no-code] <package-dir>[=<report>,...]...",
    );
    process.exit(1);
  }
  const packages = positionals.map((spec) => {
    const { dir, reports } = parsePackageSpec(spec);
    const report = mergeReports(
      reports.map((p) => JSON.parse(readFileSync(p, "utf8"))),
    );
    const { name } = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    );
    return { name, summary: summarizeReport(report) };
  });
  console.log(renderMarkdown(packages));
  if (values["idle-out"]) {
    const title = reasons
      ? `Tests that kill no mutant (${reasons.map((r) => `\`${r}\``).join(", ")})`
      : "Tests that kill no mutant";
    writeFileSync(
      values["idle-out"],
      `# ${title}\n\n${renderIdleTests(packages, { reasons })}`,
    );
  }
}
