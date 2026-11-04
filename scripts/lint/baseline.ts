import * as fs from "node:fs";
import * as path from "node:path";

// The lint gate allows the errors that exist today and fails on new ones. It
// keeps a count per (rule, file) in a checked-in JSON file. A count can only go
// down: the gate fails when a count goes up, and it fails again when a count
// goes down until someone prunes the file. So the debt is visible in review,
// and it never grows back in silence.
//
// This module holds the pure logic and the file IO. It does not run a linter.

/**
 * Error counts per rule, then per file: `{ "<rule>": { "<file>": <count> } }`.
 *
 * A rule is the `code` string the tool prints, for example
 * `typescript-eslint(no-explicit-any)` or `knip(exports)`. A file is a
 * repo-relative path. Every count is a positive integer. A pair with no errors
 * has no entry.
 */
export type Baseline = Record<string, Record<string, number>>;

/** One error-severity diagnostic: the rule that fired and the file it fired in. */
export interface Violation {
  rule: string;
  file: string;
}

/** A (rule, file) pair whose current count differs from its baseline count. */
export interface CountChange {
  rule: string;
  file: string;
  /** Errors in this run. 0 when the file no longer has any. */
  current: number;
  /** Errors the baseline allows. 0 when the pair is not in the baseline. */
  baseline: number;
}

/** What the gate reports for one run. */
export interface Comparison {
  /** Pairs with more errors than the baseline allows. Each one fails the gate. */
  over: CountChange[];
  /** Pairs with fewer errors than the baseline allows. Prune the baseline to fix. */
  stale: CountChange[];
}

/** Options for {@link compareToBaseline}. */
export interface CompareOptions {
  /**
   * The files this run checked, for a partial run such as a pre-commit hook on
   * staged files. Only these files can be over, and no pair is reported stale,
   * because the other files were not checked.
   */
  files?: readonly string[];
}

/** File shape on disk. `rules` is the {@link Baseline}. */
interface BaselineFile {
  comment: string;
  rules: Baseline;
}

function sortedKeys(...records: readonly object[]) {
  const keys = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) keys.add(key);
  }
  return [...keys].sort();
}

function sortBaseline(baseline: Baseline) {
  const sorted: Baseline = {};
  const rules = sortedKeys(baseline);
  for (const rule of rules) {
    const files = sortedKeys(baseline[rule]);
    sorted[rule] = {};
    for (const file of files) sorted[rule][file] = baseline[rule][file];
  }
  return sorted;
}

function countOf(baseline: Baseline, rule: string, file: string) {
  return baseline[rule]?.[file] ?? 0;
}

/**
 * Count violations per rule and per file.
 *
 * @param violations - Every error-severity diagnostic from one run.
 * @returns A {@link Baseline} with rules and files in sorted order.
 *
 * @example
 * countViolations([
 *   { rule: "typescript-eslint(no-explicit-any)", file: "packages/a/src/x.ts" },
 *   { rule: "typescript-eslint(no-explicit-any)", file: "packages/a/src/x.ts" },
 * ]);
 * // { "typescript-eslint(no-explicit-any)": { "packages/a/src/x.ts": 2 } }
 */
export function countViolations(violations: readonly Violation[]) {
  const counts: Baseline = {};
  for (const { rule, file } of violations) {
    counts[rule] ??= {};
    counts[rule][file] = (counts[rule][file] ?? 0) + 1;
  }
  return sortBaseline(counts);
}

/**
 * Compare the counts from one run with the baseline.
 *
 * A pair is over when the current count is higher than the baseline count. A
 * pair missing from the baseline has a baseline count of 0, so a new rule or a
 * new file is over. A pair is stale when the baseline count is higher, which
 * includes a file that no longer has errors or no longer exists.
 *
 * @param current - Counts from this run, from {@link countViolations}.
 * @param baseline - Counts from the checked-in file, from {@link readBaseline}.
 * @param options - Pass `files` for a partial run. See {@link CompareOptions}.
 * @returns `over` and `stale`, each sorted by rule, then by file.
 *
 * @example
 * const { over, stale } = compareToBaseline(current, baseline);
 * const staged = compareToBaseline(current, baseline, { files: stagedFiles });
 */
export function compareToBaseline(
  current: Baseline,
  baseline: Baseline,
  options: CompareOptions = {},
) {
  const checkedFiles =
    options.files === undefined ? null : new Set(options.files);
  const comparison: Comparison = { over: [], stale: [] };
  const rules = sortedKeys(current, baseline);

  for (const rule of rules) {
    const files = sortedKeys(current[rule] ?? {}, baseline[rule] ?? {});
    for (const file of files) {
      const change = {
        rule,
        file,
        current: countOf(current, rule, file),
        baseline: countOf(baseline, rule, file),
      };
      const isChecked = checkedFiles === null || checkedFiles.has(file);
      const isOver = isChecked && change.current > change.baseline;
      const isStale = checkedFiles === null && change.current < change.baseline;
      if (isOver) comparison.over.push(change);
      if (isStale) comparison.stale.push(change);
    }
  }

  return comparison;
}

/**
 * Lower each baseline count to the current count.
 *
 * Each entry becomes `min(baseline, current)`. Entries that reach 0 are
 * removed. Pairs that are only in `current` are not added, and no count goes
 * up, so pruning can never hide a new error.
 *
 * @param current - Counts from a full run, from {@link countViolations}.
 * @param baseline - Counts from the checked-in file, from {@link readBaseline}.
 * @returns The new {@link Baseline}, sorted.
 *
 * @example
 * writeBaseline(path, pruneBaseline(current, readBaseline(path)), comment);
 */
export function pruneBaseline(current: Baseline, baseline: Baseline) {
  const pruned: Baseline = {};
  const rules = sortedKeys(baseline);

  for (const rule of rules) {
    const files = sortedKeys(baseline[rule]);
    for (const file of files) {
      const count = Math.min(
        baseline[rule][file],
        countOf(current, rule, file),
      );
      if (count === 0) continue;
      pruned[rule] ??= {};
      pruned[rule][file] = count;
    }
  }

  return pruned;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function parseRules(rules: unknown, filePath: string) {
  if (!isRecord(rules)) {
    throw new Error(
      `${filePath}: "rules" must be an object of rule -> file -> count`,
    );
  }
  const baseline: Baseline = {};
  for (const [rule, files] of Object.entries(rules)) {
    if (!isRecord(files)) {
      throw new Error(
        `${filePath}: rules["${rule}"] must be an object of file -> count`,
      );
    }
    baseline[rule] = {};
    for (const [file, count] of Object.entries(files)) {
      if (!isPositiveInteger(count)) {
        throw new Error(
          `${filePath}: rules["${rule}"]["${file}"] must be a positive integer, got ${JSON.stringify(count)}`,
        );
      }
      baseline[rule][file] = count;
    }
  }
  return sortBaseline(baseline);
}

/**
 * Read a baseline file.
 *
 * @param filePath - Path to the JSON file, for example `.lint-baseline/oxlint.json`.
 * @returns The `rules` map as a sorted {@link Baseline}. A missing file gives
 *   `{}`, so a tool with no baseline yet allows no errors.
 * @throws Error when the file is not valid JSON or does not have the baseline
 *   shape. The message names the file and the bad entry.
 *
 * @example
 * const baseline = readBaseline(".lint-baseline/oxlint.json");
 */
export function readBaseline(filePath: string) {
  if (!fs.existsSync(filePath)) return parseRules({}, filePath);
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`${filePath}: expected an object with a "rules" field`);
  }
  return parseRules(parsed.rules, filePath);
}

/**
 * Write a baseline file as sorted, 2-space JSON with a trailing newline.
 * Creates the parent folder when it does not exist.
 *
 * @param filePath - Path to the JSON file, for example `.lint-baseline/oxlint.json`.
 * @param baseline - The counts to write.
 * @param comment - Goes in the `comment` field. Say which command generated the
 *   file, that it must not be edited by hand, and that it should only shrink.
 *
 * @example
 * writeBaseline(".lint-baseline/oxlint.json", counts,
 *   "Generated by pnpm lint:baseline. Do not edit by hand. This file should only shrink.");
 */
export function writeBaseline(
  filePath: string,
  baseline: Baseline,
  comment: string,
) {
  const contents: BaselineFile = { comment, rules: sortBaseline(baseline) };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(contents, null, 2)}\n`);
}
