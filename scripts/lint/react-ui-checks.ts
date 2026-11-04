import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseArgs } from "node:util";
import {
  compareToBaseline,
  countViolations,
  pruneBaseline,
  readBaseline,
  writeBaseline,
} from "./baseline.js";
import type { Baseline, CountChange } from "./baseline.js";
import { toRepoPath } from "./gate.js";
import type { Finding } from "./gate.js";

// The React UI gate. It runs React Doctor or impeccable detect on every React
// project under packages/, examples/, and showcase/, counts the findings per
// (rule, file), and compares the counts with the checked-in baseline in
// `.lint-baseline/`. See baseline.ts for the counting rules.
//
// Both tools are pinned in tools/ui-checks/, which has its own npm lockfile.
// It is not in the pnpm workspace: React Doctor's dependency tree re-resolves
// shared peers (for example @opentelemetry/api) across the root lockfile.

const USAGE = `Usage: tsx scripts/lint/react-ui-checks.ts --source <tool> [options]

Runs React Doctor or impeccable detect on the React projects in packages/,
examples/, and showcase/, and fails on findings that are not in the baseline
file (.lint-baseline/<source>.json).

Install the pinned tools once: npm ci --prefix tools/ui-checks

Options:
  --source react-doctor|impeccable  The tool to run. Required.
  --prune               Lower the baseline counts to the current counts, then check.
  --write-baseline      Write the baseline from scratch with the current counts.
                        For maintainers who change the tool version or rules.
  -h, --help            Show this help.

Examples:
  pnpm lint:react-doctor            Check with React Doctor.
  pnpm lint:react-doctor:prune      After you fix baselined findings.
  pnpm lint:impeccable              Check with impeccable detect.`;

const REPO_ROOT = path.resolve(__dirname, "../..");
const TOOLS_DIR = "tools/ui-checks";
const MAX_BUFFER = 1024 * 1024 * 1024;
const PROJECT_ROOTS = ["packages/", "examples/", "showcase/"];
const REACT_DEPENDENCY_FIELDS = [
  "dependencies",
  "peerDependencies",
  "devDependencies",
];

type Source = "react-doctor" | "impeccable";
type Mode = "check" | "prune" | "write-baseline";

/** Options for one run, from {@link parseUiCheckArgs}. */
export interface UiCheckArgs {
  source: Source;
  mode: Mode;
  help: boolean;
}

/** One diagnostic in a React Doctor `--json` report. */
export interface ReactDoctorDiagnostic {
  /** Relative to the project directory. */
  filePath: string;
  plugin: string;
  rule: string;
  severity: string;
  title?: string;
  message: string;
  line: number;
  offset?: number;
  length?: number;
}

/** One scanned project in a React Doctor `--json` report. */
export interface ReactDoctorProject {
  /** Absolute path. */
  directory: string;
  complete: boolean;
  diagnostics: ReactDoctorDiagnostic[];
}

/** The parts of a React Doctor `--json` report that the gate reads. */
export interface ReactDoctorReport {
  ok: boolean;
  error: unknown;
  projects: ReactDoctorProject[];
}

/** One finding in `impeccable detect --json` output. */
export interface ImpeccableFinding {
  antipattern: string;
  name?: string;
  severity: string;
  /** Absolute path. */
  file: string;
  line?: number;
  snippet?: string;
}

interface SourceConfig {
  baselinePath: string;
  checkCommand: string;
  baselineCommand: string;
  pruneCommand: string;
  /** How to see every finding in one project, for the failure message. */
  detailCommand: string;
}

const SOURCES: Record<Source, SourceConfig> = {
  "react-doctor": {
    baselinePath: ".lint-baseline/react-doctor.json",
    checkCommand: "pnpm lint:react-doctor",
    baselineCommand: "pnpm lint:react-doctor:baseline",
    pruneCommand: "pnpm lint:react-doctor:prune",
    detailCommand: `${TOOLS_DIR}/node_modules/.bin/react-doctor <project-dir> --verbose --no-telemetry`,
  },
  impeccable: {
    baselinePath: ".lint-baseline/impeccable.json",
    checkCommand: "pnpm lint:impeccable",
    baselineCommand: "pnpm lint:impeccable:baseline",
    pruneCommand: "pnpm lint:impeccable:prune",
    detailCommand: `${TOOLS_DIR}/node_modules/.bin/impeccable detect <file>`,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a parsed `package.json` declares `react` as a dependency, a peer
 * dependency, or a dev dependency.
 *
 * @example
 * isReactManifest({ peerDependencies: { react: ">=18" } }); // true
 * isReactManifest({ dependencies: { "react-dom": "19" } }); // false
 */
export function isReactManifest(manifest: unknown) {
  if (!isRecord(manifest)) return false;
  return REACT_DEPENDENCY_FIELDS.some((field) => {
    const deps = manifest[field];
    return isRecord(deps) && "react" in deps;
  });
}

/**
 * The directories of the tracked manifests that are React projects in the
 * gated roots (packages/, examples/, showcase/), sorted.
 *
 * @param trackedFiles - Repo-relative tracked paths, from `git ls-files`.
 * @param readManifest - Reads and parses a repo-relative `package.json`.
 */
export function reactProjectDirs(
  trackedFiles: Iterable<string>,
  readManifest: (file: string) => unknown,
) {
  const dirs: string[] = [];
  for (const file of trackedFiles) {
    const isManifest =
      file.endsWith("/package.json") &&
      PROJECT_ROOTS.some((root) => file.startsWith(root));
    if (isManifest && isReactManifest(readManifest(file))) {
      dirs.push(path.posix.dirname(file));
    }
  }
  return dirs.sort();
}

/**
 * Drop each directory that is inside another directory of the list, so a tool
 * that walks directories scans each file once.
 *
 * @example
 * outermostDirs(["a", "a/b", "ab"]); // ["a", "ab"]
 */
export function outermostDirs(dirs: readonly string[]) {
  return dirs
    .filter((dir) => !dirs.some((other) => dir.startsWith(`${other}/`)))
    .sort();
}

/**
 * Turn a React Doctor report into findings. The rule is `<plugin>/<rule>`, for
 * example `react-doctor/no-array-index-as-key`. Errors and warnings both
 * count. A diagnostic that two nested projects both report counts once.
 *
 * @param report - The parsed `react-doctor --json` report.
 * @param root - The repo root, to make file paths repo-relative.
 */
export function reactDoctorFindings(report: ReactDoctorReport, root: string) {
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const project of report.projects) {
    for (const diagnostic of project.diagnostics) {
      const file = toRepoPath(
        path.join(project.directory, diagnostic.filePath),
        root,
      );
      const rule = `${diagnostic.plugin}/${diagnostic.rule}`;
      const where = `${diagnostic.line}:${diagnostic.offset ?? ""}+${diagnostic.length ?? ""}`;
      const key = `${rule}\0${file}\0${where}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        rule,
        file,
        line: diagnostic.line,
        message: diagnostic.title ?? diagnostic.message,
      });
    }
  }
  return findings;
}

/**
 * Turn `impeccable detect --json` output into findings. The rule is
 * `impeccable/<antipattern>`, for example `impeccable/low-contrast`.
 * Advisory findings never count: impeccable does not fail on them either.
 *
 * @param results - The parsed `impeccable detect --json` output.
 * @param root - The repo root, to make file paths repo-relative.
 */
export function impeccableFindings(
  results: readonly ImpeccableFinding[],
  root: string,
) {
  return results
    .filter((result) => result.severity !== "advisory")
    .map((result) => {
      const name = result.name ?? result.antipattern;
      const finding: Finding = {
        rule: `impeccable/${result.antipattern}`,
        file: toRepoPath(result.file, root),
        line: result.line ?? 0,
        message: result.snippet ? `${name}: ${result.snippet}` : name,
      };
      return finding;
    });
}

/**
 * Split findings into those in tracked files and a count of the rest. Build
 * output and local installs are not tracked, and differ between machines.
 */
export function keepTracked(
  findings: readonly Finding[],
  trackedFiles: ReadonlySet<string>,
) {
  const kept = findings.filter((finding) => trackedFiles.has(finding.file));
  return { kept, untracked: findings.length - kept.length };
}

function isSource(value: string | undefined): value is Source {
  return value === "react-doctor" || value === "impeccable";
}

/**
 * Parse and check the command-line arguments.
 *
 * @throws Error with a message for the user when `--source` is missing or
 *   unknown, or when the modes conflict.
 */
export function parseUiCheckArgs(argv: readonly string[]) {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    options: {
      source: { type: "string" },
      prune: { type: "boolean", default: false },
      "write-baseline": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const { source, prune, help } = values;
  const writeBaselineMode = values["write-baseline"];

  let mode: Mode = "check";
  if (prune) mode = "prune";
  if (writeBaselineMode) mode = "write-baseline";
  if (help) {
    const args: UiCheckArgs = { source: "react-doctor", mode, help };
    return args;
  }
  if (!isSource(source)) {
    throw new Error(
      `--source must be "react-doctor" or "impeccable", got ${JSON.stringify(source)}`,
    );
  }
  if (prune && writeBaselineMode) {
    throw new Error("use --prune or --write-baseline, not both");
  }
  const args: UiCheckArgs = { source, mode, help };
  return args;
}

function toolBinary(name: string) {
  const binary = path.join(REPO_ROOT, TOOLS_DIR, "node_modules", ".bin", name);
  if (!fs.existsSync(binary)) {
    throw new Error(
      `${name} is not installed. Run: npm ci --prefix ${TOOLS_DIR}`,
    );
  }
  return binary;
}

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr}`);
  }
  return new Set(result.stdout.split("\0").filter(Boolean));
}

function readManifest(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, file), "utf8"));
}

// The tools document their JSON shape. These guards check what the gate
// reads, so a tool upgrade that changes the shape fails loudly instead of
// counting 0.
function isReactDoctorReport(value: unknown): value is ReactDoctorReport {
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    Array.isArray(value.projects) &&
    value.projects.every(
      (project) =>
        isRecord(project) &&
        typeof project.directory === "string" &&
        Array.isArray(project.diagnostics),
    )
  );
}

function isImpeccableOutput(value: unknown): value is ImpeccableFinding[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.antipattern === "string" &&
        typeof item.file === "string",
    )
  );
}

function runReactDoctor(dirs: readonly string[]) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-"));
  const outFile = path.join(outDir, "report.json");
  try {
    // --blocking none: the gate decides what fails, not the tool.
    // --no-telemetry also skips the score API and the share URL.
    const result = spawnSync(
      toolBinary("react-doctor"),
      [
        ".",
        "--project",
        dirs.join(","),
        "--json",
        "--json-compact",
        "--json-out",
        outFile,
        "--no-telemetry",
        "--no-supply-chain",
        "--no-cache",
        "--blocking",
        "none",
        "--yes",
      ],
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: MAX_BUFFER },
    );
    if (result.error) {
      throw new Error(`could not run react-doctor: ${result.error.message}`);
    }
    if (result.status !== 0 || !fs.existsSync(outFile)) {
      throw new Error(
        `react-doctor exited ${result.status} without a report.\n` +
          `stderr:\n${result.stderr}\nstdout:\n${result.stdout}`,
      );
    }
    const report: unknown = JSON.parse(fs.readFileSync(outFile, "utf8"));
    if (!isReactDoctorReport(report)) {
      throw new Error("react-doctor JSON report has no projects list");
    }
    if (!report.ok) {
      throw new Error(`react-doctor failed: ${JSON.stringify(report.error)}`);
    }
    // A partial scan would make counts drop and look like fixed findings.
    const partial = report.projects.filter((project) => !project.complete);
    if (partial.length > 0) {
      const names = partial.map((p) => toRepoPath(p.directory, REPO_ROOT));
      throw new Error(`react-doctor did not finish: ${names.join(", ")}`);
    }
    return reactDoctorFindings(report, REPO_ROOT);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

function runImpeccable(dirs: readonly string[]) {
  const result = spawnSync(
    toolBinary("impeccable"),
    ["detect", "--json", "--no-advisory", ...outermostDirs(dirs)],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      env: { ...process.env, DO_NOT_TRACK: "1", IMPECCABLE_NO_TELEMETRY: "1" },
    },
  );
  if (result.error) {
    throw new Error(`could not run impeccable: ${result.error.message}`);
  }
  // 0: no findings. 2: findings. Anything else: a target could not be scanned.
  if (result.status !== 0 && result.status !== 2) {
    throw new Error(
      `impeccable detect exited ${result.status}.\nstderr:\n${result.stderr}`,
    );
  }
  const output: unknown = JSON.parse(result.stdout);
  if (!isImpeccableOutput(output)) {
    throw new Error("impeccable detect JSON output is not a list of findings");
  }
  return impeccableFindings(output, REPO_ROOT);
}

function firstFindings(findings: readonly Finding[]) {
  const first = new Map<string, Finding>();
  for (const finding of findings) {
    const key = `${finding.rule}\0${finding.file}`;
    if (!first.has(key)) first.set(key, finding);
  }
  return first;
}

function escapeAnnotation(text: string) {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function printOver(
  over: readonly CountChange[],
  findings: readonly Finding[],
  config: SourceConfig,
) {
  const first = firstFindings(findings);
  const added = over.reduce(
    (sum, change) => sum + change.current - change.baseline,
    0,
  );
  const files = new Set(over.map((change) => change.file));
  console.error(
    `${added} new finding(s) in ${files.size} file(s), over the baseline:\n`,
  );
  const byFile = [...over].sort(
    (a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule),
  );
  let lastFile = "";
  for (const change of byFile) {
    if (change.file !== lastFile) console.error(change.file);
    lastFile = change.file;
    console.error(
      `  ${change.rule}: ${change.current} (allowed ${change.baseline})`,
    );
    const hit = first.get(`${change.rule}\0${change.file}`);
    if (!hit) continue;
    const where = hit.line > 0 ? `line ${hit.line}: ` : "";
    console.error(`    first: ${where}${hit.message}`);
    if (process.env.GITHUB_ACTIONS === "true") {
      const line = hit.line > 0 ? `,line=${hit.line}` : "";
      console.log(
        `::error file=${hit.file}${line},title=${hit.rule}::${escapeAnnotation(hit.message)}`,
      );
    }
  }
  console.error(
    `\nFix the new findings. To see every finding: ${config.detailCommand}\n` +
      "How to fix a failure: dev-docs/react-ui-checks.md\n",
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
    `\nGood, findings went away. Run ${config.pruneCommand} and commit ${config.baselinePath}.\n`,
  );
}

function baselineComment(config: SourceConfig) {
  return (
    `Generated by ${config.baselineCommand} (scripts/lint/react-ui-checks.ts). Do not edit by hand. ` +
    `Counts of allowed findings per rule and file. This file should only shrink: ` +
    `after you fix findings, run ${config.pruneCommand}.`
  );
}

function totalOf(baseline: Baseline) {
  return Object.values(baseline)
    .flatMap((files) => Object.values(files))
    .reduce((sum, count) => sum + count, 0);
}

function main(args: UiCheckArgs) {
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const config = SOURCES[args.source];
  const label = `react ui check (${args.source})`;
  const baselinePath = path.join(REPO_ROOT, config.baselinePath);
  const tracked = trackedFiles();
  const dirs = reactProjectDirs(tracked, readManifest);

  const startedAt = Date.now();
  const all =
    args.source === "react-doctor" ? runReactDoctor(dirs) : runImpeccable(dirs);
  const { kept: findings, untracked } = keepTracked(all, tracked);
  const current = countViolations(findings);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`${label}: scanned ${dirs.length} React project(s).`);
  if (untracked > 0) {
    console.log(
      `${label}: ${untracked} finding(s) in untracked files, not gated.`,
    );
  }

  if (args.mode === "write-baseline") {
    writeBaseline(baselinePath, current, baselineComment(config));
    console.log(
      `${label}: wrote ${findings.length} finding(s) in ${Object.keys(current).length} rule(s) to ${config.baselinePath}.`,
    );
    return 0;
  }

  let baseline = readBaseline(baselinePath);
  if (args.mode === "prune") {
    const pruned = pruneBaseline(current, baseline);
    writeBaseline(baselinePath, pruned, baselineComment(config));
    console.log(
      `${label}: pruned ${config.baselinePath} from ${totalOf(baseline)} to ${totalOf(pruned)} allowed finding(s).`,
    );
    baseline = pruned;
  }

  const { over, stale } = compareToBaseline(current, baseline);
  if (over.length > 0) printOver(over, findings, config);
  if (stale.length > 0) printStale(stale, config);
  if (over.length > 0 || stale.length > 0) {
    console.error(`${label}: failed (${seconds}s).`);
    return 1;
  }

  console.log(
    `${label}: OK. ${findings.length} finding(s), all within the baseline (${seconds}s).`,
  );
  return 0;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function cli() {
  let args: UiCheckArgs;
  try {
    args = parseUiCheckArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`react ui check: ${errorMessage(error)}\n\n${USAGE}`);
    return 2;
  }
  try {
    return main(args);
  } catch (error) {
    console.error(`react ui check: ${errorMessage(error)}`);
    return 2;
  }
}

// Guard the CLI path so the exported helpers stay importable from tests.
// Set exitCode instead of calling process.exit, so piped output is not cut off.
if (process.argv[1] && process.argv[1].endsWith("react-ui-checks.ts")) {
  process.exitCode = cli();
}
