import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import {
  compareToBaseline,
  countViolations,
  pruneBaseline,
  readBaseline,
  writeBaseline,
} from "./baseline.js";
import type { Baseline, CountChange, Violation } from "./baseline.js";

// The lint gate. It runs one tool (oxlint or knip), counts the error-severity
// findings per (rule, file), and compares the counts with the checked-in
// baseline in `.lint-baseline/`. See baseline.ts for the counting rules.
//
// oxlint runs in two passes. Pass 1 lints the whole repo without types. Pass 2
// lints `packages/` with `--type-aware`, which needs `oxlint-tsgolint`. Pass 2
// also repeats the pass 1 rules for `packages/`, so the gate removes the
// duplicates before it counts.

const USAGE = `Usage: tsx scripts/lint/gate.ts [options] [files...]

Runs oxlint or knip and fails on error-severity findings that are not in the
baseline file (.lint-baseline/<source>.json).

Options:
  --source oxlint|knip  The tool to run. Default: oxlint.
  --prune               Lower the baseline counts to the current counts, then check.
  --write-baseline      Write the baseline from scratch with the current counts.
                        For maintainers who change the rules.
  --fix                 Pass --fix to oxlint (pass 1 only). Not for knip.
  -h, --help            Show this help.

Files:
  Give a list of files to check only those files, for example the staged files
  in a pre-commit hook. Files that the tool does not lint are ignored. A file
  list cannot be used with --prune or --write-baseline, because the other files
  are not checked.

Examples:
  pnpm lint                          Check the repo with oxlint.
  pnpm lint -- packages/core/src/index.ts
  pnpm lint:prune                    After you fix baselined errors.
  pnpm lint:dead-code                Check the repo with knip.`;

const REPO_ROOT = path.resolve(__dirname, "../..");
const MAX_BUFFER = 1024 * 1024 * 1024;

/** The rule name for a diagnostic that has no `code`, such as a parse error. */
export const NO_CODE_RULE = "oxc(parse-error)";

/** Extensions oxlint lints. Other files in a file list are ignored. */
const LINTABLE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".vue",
  ".astro",
  ".svelte",
]);

const TYPE_AWARE_ROOT = "packages";

type Source = "oxlint" | "knip";
type Mode = "check" | "prune" | "write-baseline";

/** Options for one gate run, from {@link parseGateArgs}. */
export interface GateArgs {
  source: Source;
  mode: Mode;
  /** Pass `--fix` to oxlint pass 1. */
  fix: boolean;
  /** Repo-relative files for a partial run. `undefined` checks the whole repo. */
  files: string[] | undefined;
  help: boolean;
}

/** One error-severity finding, with what the reader needs to find it. */
export interface Finding extends Violation {
  /** 1-based line, or 0 when the tool gives none. */
  line: number;
  message: string;
}

/** One diagnostic from `oxlint -f json`. */
export interface OxlintDiagnostic {
  /** Missing for some diagnostics, for example parse errors. */
  code?: string;
  severity: "error" | "warning" | "advice";
  filename: string;
  message: string;
  labels?: {
    span: { offset: number; length: number; line: number; column: number };
  }[];
}

/** One item in a knip JSON issue list. Binaries have only `name`. */
interface KnipItem {
  name: string;
  line?: number;
}

/** One row of `knip --reporter json`: the issues found in one file. */
interface KnipRow {
  file: string;
  [type: string]: unknown;
}

/** The output of `knip --reporter json`. */
export interface KnipReport {
  /** Unused files. */
  files: string[];
  issues: KnipRow[];
}

interface SourceConfig {
  baselinePath: string;
  baselineCommand: string;
  pruneCommand: string;
  /** How to see every finding for a file, for the failure message. */
  detailCommand: string;
}

const SOURCES: Record<Source, SourceConfig> = {
  oxlint: {
    baselinePath: ".lint-baseline/oxlint.json",
    baselineCommand: "pnpm lint:baseline",
    pruneCommand: "pnpm lint:prune",
    detailCommand: "pnpm exec oxlint -c .oxlintrc.json --type-aware <file>",
  },
  knip: {
    baselinePath: ".lint-baseline/knip.json",
    baselineCommand: "pnpm lint:dead-code:baseline",
    pruneCommand: "pnpm lint:dead-code:prune",
    detailCommand: "pnpm exec knip",
  },
};

/**
 * Turn a path from a tool or from the command line into a repo-relative path
 * with forward slashes, the form the baseline uses.
 *
 * @param file - An absolute path, or a path relative to `root`.
 * @param root - The repo root.
 *
 * @example
 * toRepoPath("/repo/packages/a.ts", "/repo"); // "packages/a.ts"
 * toRepoPath("./packages/a.ts", "/repo");     // "packages/a.ts"
 */
export function toRepoPath(file: string, root: string) {
  return path
    .relative(root, path.resolve(root, file))
    .split(path.sep)
    .join("/");
}

/**
 * Whether oxlint lints this repo-relative path. Paths outside the repo are
 * never lintable: oxlint crashes on them.
 */
export function isLintable(file: string) {
  const isOutsideRepo = file === ".." || file.startsWith("../");
  return !isOutsideRepo && LINTABLE_EXTENSIONS.has(path.extname(file));
}

function diagnosticKey(diagnostic: OxlintDiagnostic) {
  const span = diagnostic.labels?.[0]?.span;
  const where = span === undefined ? "" : `${span.offset}+${span.length}`;
  return `${diagnostic.code ?? ""}\0${diagnostic.filename}\0${where}`;
}

/**
 * Remove repeated diagnostics. Two diagnostics are the same when they have the
 * same code, file, and first label span (offset and length). Pass 2 of the
 * oxlint run repeats the pass 1 rules for `packages/`, so the merged list has
 * each of those twice. The length matters: a nested assertion such as
 * `(x as A) as B` gives two diagnostics at the same offset.
 *
 * @param diagnostics - The diagnostics of both passes, in any order.
 * @returns The first copy of each diagnostic, in input order.
 */
export function dedupeDiagnostics(diagnostics: readonly OxlintDiagnostic[]) {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = diagnosticKey(diagnostic);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Split oxlint diagnostics into gated errors and a count of the rest.
 *
 * @param diagnostics - Deduplicated diagnostics, from {@link dedupeDiagnostics}.
 * @param root - The repo root, to make file paths repo-relative.
 * @returns `errors` as findings (a diagnostic with no `code` counts under
 *   {@link NO_CODE_RULE}), and `warnings`, the number of other diagnostics.
 */
export function oxlintFindings(
  diagnostics: readonly OxlintDiagnostic[],
  root: string,
) {
  const errors: Finding[] = [];
  let warnings = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== "error") {
      warnings += 1;
      continue;
    }
    errors.push({
      rule: diagnostic.code ?? NO_CODE_RULE,
      file: toRepoPath(diagnostic.filename, root),
      line: diagnostic.labels?.[0]?.span.line ?? 0,
      message: diagnostic.message,
    });
  }
  return { errors, warnings };
}

function isKnipItem(value: unknown): value is KnipItem {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string"
  );
}

/**
 * One finding for a group of names that export the same thing, from the
 * `duplicates` issue type. The name is the group joined with " = ", for
 * example "Foo = default". The line is the line of the first name.
 */
function duplicateGroup(value: unknown): KnipItem[] {
  if (!Array.isArray(value)) return [];
  const names = value.filter(isKnipItem);
  const first = names[0];
  if (first === undefined) return [];
  return [
    { name: names.map((item) => item.name).join(" = "), line: first.line },
  ];
}

/**
 * The items of one issue type in a knip row. Most types are a list of items.
 * `duplicates` is a list of groups, and each group gives one item.
 * `enumMembers` and `classMembers` are a map of parent name to a list.
 */
function knipItems(value: unknown) {
  if (Array.isArray(value)) {
    return value.flatMap((entry: unknown) =>
      Array.isArray(entry) ? duplicateGroup(entry) : [entry].filter(isKnipItem),
    );
  }
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap((items: unknown) =>
    Array.isArray(items) ? items.filter(isKnipItem) : [],
  );
}

/**
 * Turn a `knip --reporter json` report into findings, one per reported item.
 * The rule is `knip(<type>)`, for example `knip(exports)`.
 *
 * @param report - The parsed knip output.
 * @param root - The repo root, to make file paths repo-relative.
 *
 * @example
 * knipFindings({ files: ["packages/a/src/old.ts"], issues: [] }, root);
 * // [{ rule: "knip(files)", file: "packages/a/src/old.ts", line: 0, message: "unused file" }]
 */
export function knipFindings(report: KnipReport, root: string) {
  const findings: Finding[] = report.files.map((file) => ({
    rule: "knip(files)",
    file: toRepoPath(file, root),
    line: 0,
    message: "unused file",
  }));
  for (const row of report.issues) {
    const file = toRepoPath(row.file, root);
    for (const [type, value] of Object.entries(row)) {
      if (type === "file" || type === "owners") continue;
      const items = knipItems(value);
      for (const item of items) {
        findings.push({
          rule: `knip(${type})`,
          file,
          line: item.line ?? 0,
          message: item.name,
        });
      }
    }
  }
  return findings;
}

function isSource(value: string): value is Source {
  return value === "oxlint" || value === "knip";
}

/**
 * Parse and check the command-line arguments.
 *
 * @param argv - The arguments after the script path.
 * @param root - The repo root, to make the file list repo-relative.
 * @throws Error with a message for the user when the arguments do not make
 *   sense together, for example a file list with `--prune`.
 */
export function parseGateArgs(argv: readonly string[], root: string) {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      source: { type: "string", default: "oxlint" },
      prune: { type: "boolean", default: false },
      "write-baseline": { type: "boolean", default: false },
      fix: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const { source, prune, fix, help } = values;
  const writeBaselineMode = values["write-baseline"];
  const hasFiles = positionals.length > 0;

  if (!isSource(source)) {
    throw new Error(`--source must be "oxlint" or "knip", got "${source}"`);
  }
  if (prune && writeBaselineMode) {
    throw new Error("use --prune or --write-baseline, not both");
  }
  if (hasFiles && (prune || writeBaselineMode)) {
    throw new Error(
      "--prune and --write-baseline need a full run. Remove the file list.",
    );
  }
  if (fix && source === "knip") {
    throw new Error("--fix is for oxlint only");
  }

  let mode: Mode = "check";
  if (prune) mode = "prune";
  if (writeBaselineMode) mode = "write-baseline";
  const files = hasFiles
    ? positionals.map((file) => toRepoPath(path.resolve(file), root))
    : undefined;
  const args: GateArgs = { source, mode, fix, files, help };
  return args;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runTool(command: string, args: string[]) {
  const binary = path.join(REPO_ROOT, "node_modules", ".bin", command);
  const result = spawnSync(binary, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  if (result.error) {
    throw new Error(`could not run ${command}: ${result.error.message}`);
  }
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    return parsed;
  } catch {
    throw new Error(
      `${command} ${args.join(" ")} did not print JSON (exit ${result.status}).\n` +
        `stderr:\n${result.stderr}`,
    );
  }
}

// The tools document their JSON shape. These guards check the top level only,
// so a tool upgrade that changes the shape fails loudly instead of counting 0.
function isOxlintOutput(
  value: unknown,
): value is { diagnostics: OxlintDiagnostic[] } {
  return isRecord(value) && Array.isArray(value.diagnostics);
}

function isKnipReport(value: unknown): value is KnipReport {
  return (
    isRecord(value) && Array.isArray(value.files) && Array.isArray(value.issues)
  );
}

function runOxlintPass(args: string[]) {
  const output = runTool("oxlint", [
    "-c",
    ".oxlintrc.json",
    "-f",
    "json",
    ...args,
  ]);
  if (!isOxlintOutput(output)) {
    throw new Error(
      `oxlint ${args.join(" ")}: JSON output has no "diagnostics" list`,
    );
  }
  return output.diagnostics;
}

/** Packages whose manifest points into `dist/` while `dist/` is missing. */
function packagesMissingDist() {
  const packagesDir = path.join(REPO_ROOT, TYPE_AWARE_ROOT);
  const names = fs.readdirSync(packagesDir);
  return names.filter((name) => {
    const manifestPath = path.join(packagesDir, name, "package.json");
    if (!fs.existsSync(manifestPath)) return false;
    const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!isRecord(manifest)) return false;
    const entryPoints = JSON.stringify([manifest.main, manifest.exports]);
    const pointsIntoDist = /"(\.\/)?dist\//.test(entryPoints);
    return (
      pointsIntoDist && !fs.existsSync(path.join(packagesDir, name, "dist"))
    );
  });
}

function runOxlint(files: string[] | undefined, fix: boolean) {
  const missingDist = packagesMissingDist();
  if (missingDist.length > 0) {
    console.warn(
      `warning: ${missingDist.length} package(s) are not built (${missingDist.join(", ")}).\n` +
        "Type-aware results need built packages and can differ. Run pnpm build first.\n",
    );
  }

  const pass1Targets = files ?? ["."];
  const pass2Targets = files?.filter((file) =>
    file.startsWith(`${TYPE_AWARE_ROOT}/`),
  ) ?? [TYPE_AWARE_ROOT];
  const fixArgs = fix ? ["--fix"] : [];

  const pass1 = runOxlintPass([...fixArgs, ...pass1Targets]);
  const pass2 =
    pass2Targets.length > 0
      ? runOxlintPass(["--type-aware", ...pass2Targets])
      : [];
  return oxlintFindings(dedupeDiagnostics([...pass1, ...pass2]), REPO_ROOT);
}

function runKnip() {
  const output = runTool("knip", ["--reporter", "json", "--no-exit-code"]);
  if (!isKnipReport(output)) {
    throw new Error('knip JSON output has no "files" and "issues" lists');
  }
  return { errors: knipFindings(output, REPO_ROOT), warnings: 0 };
}

function firstFindings(findings: readonly Finding[]) {
  const first = new Map<string, Finding>();
  for (const finding of findings) {
    const key = `${finding.rule}\0${finding.file}`;
    if (!first.has(key)) first.set(key, finding);
  }
  return first;
}

function printOver(
  over: readonly CountChange[],
  findings: readonly Finding[],
  config: SourceConfig,
) {
  const first = firstFindings(findings);
  const byFile = new Map<string, CountChange[]>();
  for (const change of over) {
    const changes = byFile.get(change.file) ?? [];
    changes.push(change);
    byFile.set(change.file, changes);
  }
  const newErrors = over.reduce(
    (sum, change) => sum + change.current - change.baseline,
    0,
  );

  console.error(
    `${newErrors} new error(s) in ${byFile.size} file(s), over the baseline:\n`,
  );
  const files = [...byFile.keys()].sort();
  for (const file of files) {
    const changes = byFile.get(file) ?? [];
    console.error(file);
    for (const change of changes) {
      const hit = first.get(`${change.rule}\0${file}`);
      console.error(
        `  ${change.rule}: ${change.current} (allowed ${change.baseline})`,
      );
      if (hit) {
        const where = hit.line > 0 ? `line ${hit.line}: ` : "";
        console.error(`    first: ${where}${hit.message}`);
      }
    }
  }
  console.error(
    `\nFix the new errors. To see every hit in a file: ${config.detailCommand}\n`,
  );
}

function printStale(stale: readonly CountChange[], config: SourceConfig) {
  console.error(
    `${stale.length} baseline entr${stale.length === 1 ? "y is" : "ies are"} above the current count:\n`,
  );
  for (const change of stale) {
    console.error(
      `  ${change.file}  ${change.rule}: ${change.current} (baseline ${change.baseline})`,
    );
  }
  console.error(
    `\nGood, errors went away. Run ${config.pruneCommand} and commit ${config.baselinePath}.\n`,
  );
}

function baselineComment(config: SourceConfig) {
  return (
    `Generated by ${config.baselineCommand} (scripts/lint/gate.ts). Do not edit by hand. ` +
    `Counts of allowed errors per rule and file. This file should only shrink: ` +
    `after you fix errors, run ${config.pruneCommand}.`
  );
}

function totalOf(baseline: Baseline) {
  return Object.values(baseline)
    .flatMap((files) => Object.values(files))
    .reduce((sum, count) => sum + count, 0);
}

function lintableFiles(files: readonly string[]) {
  return files.filter(
    (file) => isLintable(file) && fs.existsSync(path.join(REPO_ROOT, file)),
  );
}

function main(args: GateArgs) {
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const config = SOURCES[args.source];
  const label = `lint gate (${args.source})`;
  const baselinePath = path.join(REPO_ROOT, config.baselinePath);
  const files =
    args.files === undefined || args.source === "knip"
      ? args.files
      : lintableFiles(args.files);
  if (files?.length === 0) {
    console.log(`${label}: no lintable files given, nothing to check.`);
    return 0;
  }

  const startedAt = Date.now();
  const result =
    args.source === "oxlint" ? runOxlint(files, args.fix) : runKnip();
  // A tool can report on a file outside the list, for example a tsconfig.json.
  // A partial run counts only the files it was given.
  const checkedFiles = new Set(files);
  const errors =
    files === undefined
      ? result.errors
      : result.errors.filter((error) => checkedFiles.has(error.file));
  const { warnings } = result;
  const current = countViolations(errors);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (warnings > 0) {
    console.log(`${label}: ${warnings} warning(s), not gated.`);
  }

  if (args.mode === "write-baseline") {
    writeBaseline(baselinePath, current, baselineComment(config));
    console.log(
      `${label}: wrote ${errors.length} error(s) in ${Object.keys(current).length} rule(s) to ${config.baselinePath}.`,
    );
    return 0;
  }

  let baseline = readBaseline(baselinePath);
  if (args.mode === "prune") {
    const pruned = pruneBaseline(current, baseline);
    writeBaseline(baselinePath, pruned, baselineComment(config));
    console.log(
      `${label}: pruned ${config.baselinePath} from ${totalOf(baseline)} to ${totalOf(pruned)} allowed error(s).`,
    );
    baseline = pruned;
  }

  const { over, stale } = compareToBaseline(current, baseline, { files });
  if (over.length > 0) printOver(over, errors, config);
  if (stale.length > 0) printStale(stale, config);
  if (over.length > 0 || stale.length > 0) {
    console.error(`${label}: failed (${seconds}s).`);
    return 1;
  }

  const scope = files === undefined ? "the repo" : `${files.length} file(s)`;
  console.log(
    `${label}: OK. ${errors.length} error(s) in ${scope}, all within the baseline (${seconds}s).`,
  );
  return 0;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function cli() {
  let args: GateArgs;
  try {
    args = parseGateArgs(process.argv.slice(2), REPO_ROOT);
  } catch (error) {
    console.error(`lint gate: ${errorMessage(error)}\n\n${USAGE}`);
    return 2;
  }
  try {
    return main(args);
  } catch (error) {
    console.error(`lint gate: ${errorMessage(error)}`);
    return 2;
  }
}

// Guard the CLI path so the exported helpers stay importable from tests.
// Set exitCode instead of calling process.exit, so piped output is not cut off.
if (process.argv[1] && process.argv[1].endsWith("gate.ts")) {
  process.exitCode = cli();
}
