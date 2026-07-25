/**
 * Test-Vacuity + Constant-Drift Gate — IO driver / CLI
 *
 * Walks every test source under `showcase/`, runs the pure rules in
 * `lib/test-vacuity-core.ts` over each one, checks the duplicated-constant pins
 * in `duplicated-constants.json`, subtracts `test-vacuity-allowlist.json`, and
 * exits non-zero with `file:line — why` for anything left.
 *
 * See `lib/test-vacuity-core.ts` for WHY each rule exists (short version: 43% of
 * PR #6156's round-2 toothless-guard findings were in files its own round-1
 * fixes had just written, and two mechanically-detectable shapes accounted for
 * most of them).
 *
 * The gate that actually runs in CI is `__tests__/validate-test-vacuity.test.ts`
 * — it is picked up by the `pnpm exec vitest run` step ("Run build pipeline
 * tests") in `.github/workflows/showcase_validate.yml`, which fires on every PR
 * touching `showcase/**`. This CLI exists so the same check is one command
 * locally, and so its output is quotable in a PR body.
 *
 * ALLOWLIST POLICY
 * ----------------
 * `test-vacuity-allowlist.json` is a SHRINK-ONLY ratchet. Every entry carries a
 * date, a justification and the owner that will remove it. Entries are keyed by
 * `{rule, file, symbol}` — NOT by line number, so unrelated edits above the
 * violation do not invalidate them. An entry whose file exists but whose
 * violation is gone is reported as STALE and fails the gate, so the allowlist
 * cannot quietly become permanent cover. An entry naming a file that does not
 * exist yet is PENDING (used to pre-register violations arriving on an unmerged
 * branch) and is neither enforced nor reported stale.
 *
 * Usage:
 *   pnpm exec tsx showcase/scripts/validate-test-vacuity.ts
 *   pnpm exec tsx showcase/scripts/validate-test-vacuity.ts --json
 *   pnpm exec tsx showcase/scripts/validate-test-vacuity.ts --all   # ignore allowlist
 *
 * Exit code 0 = clean; 1 = violations (or a stale allowlist entry).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  checkDuplicatedConstants,
  scanTestSource,
} from "./lib/test-vacuity-core.js";
import type {
  DuplicatedConstantPin,
  TunedConstantEntry,
  Violation,
} from "./lib/test-vacuity-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPTS_DIR = __dirname;
export const SHOWCASE_ROOT = path.resolve(__dirname, "..");
export const REPO_ROOT = path.resolve(SHOWCASE_ROOT, "..");

export const ALLOWLIST_PATH = path.join(
  SCRIPTS_DIR,
  "test-vacuity-allowlist.json",
);
export const DUPLICATED_CONSTANTS_PATH = path.join(
  SCRIPTS_DIR,
  "duplicated-constants.json",
);

/** Directory names never worth scanning (vendored, generated, or inert data). */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".venv",
  "venv",
  "coverage",
  "__pycache__",
  "playwright-report",
  "test-results",
  // Inert `*.spec.ts` data consumed BY validate-parity's tests; not suites.
  "fixtures",
]);

const TEST_FILE_RE = /\.(?:test|spec)\.tsx?$/;

export interface AllowlistEntry {
  rule: string;
  file: string;
  symbol: string;
  /** ISO date the entry was added. */
  added: string;
  /** Why it is not fixed here, and who/what owns the fix. */
  justification: string;
  owner: string;
}

interface AllowlistFile {
  _policy?: string;
  entries: AllowlistEntry[];
}

interface DuplicatedConstantsFile {
  _policy?: string;
  tunedConstants?: TunedConstantEntry[];
  pins: DuplicatedConstantPin[];
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Every test file under `root`, as repo-relative POSIX paths, sorted. */
export function findTestFiles(root: string, repoRoot: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        // showcase/integrations/*/{tools,_shared,shared-tools} are symlinks into
        // showcase/shared/... — following them would scan the same file under
        // many paths and duplicate every violation. The shared source is walked
        // directly via showcase/shared.
        continue;
      }
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (entry.isFile() && TEST_FILE_RE.test(entry.name)) {
        found.push(path.relative(repoRoot, full).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  return found.sort();
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  const text = fs.readFileSync(file, "utf8");
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(
      `${path.basename(file)}: JSON syntax error: ${(e as Error).message}`,
      { cause: e },
    );
  }
}

export function loadAllowlist(file = ALLOWLIST_PATH): AllowlistEntry[] {
  const parsed = readJson<AllowlistFile>(file, { entries: [] });
  const entries = parsed.entries ?? [];
  for (const [i, entry] of entries.entries()) {
    for (const field of [
      "rule",
      "file",
      "symbol",
      "added",
      "justification",
      "owner",
    ] as const) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "") {
        throw new Error(
          `${path.basename(file)}: entries[${i}] is missing required field "${field}". Every allowlist entry must be dated, justified and owned.`,
        );
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.added)) {
      throw new Error(
        `${path.basename(file)}: entries[${i}].added ("${entry.added}") must be an ISO date (YYYY-MM-DD).`,
      );
    }
  }
  return entries;
}

export function loadDuplicatedConstants(
  file = DUPLICATED_CONSTANTS_PATH,
): DuplicatedConstantsFile {
  const parsed = readJson<DuplicatedConstantsFile>(file, { pins: [] });
  return {
    tunedConstants: parsed.tunedConstants ?? [],
    pins: parsed.pins ?? [],
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export interface GateResult {
  /** Violations not covered by the allowlist. */
  violations: Violation[];
  /** All violations, allowlisted or not. */
  all: Violation[];
  /** Allowlist entries whose file exists but whose violation is gone. */
  stale: AllowlistEntry[];
  /** Allowlist entries whose file does not exist yet (pre-registered). */
  pending: AllowlistEntry[];
  filesScanned: number;
}

/**
 * Allowlist / violation identity: rule + file + symbol, deliberately WITHOUT
 * the line number so an unrelated edit above a violation does not invalidate
 * its entry. JSON-encoded rather than joined on a separator character, because
 * a symbol is an arbitrary source expression and any printable delimiter could
 * appear inside one.
 */
const key = (v: { rule: string; file: string; symbol: string }): string =>
  JSON.stringify([v.rule, v.file, v.symbol]);

/**
 * Run every rule over the tree and reconcile against the allowlist.
 *
 * `repoRoot` is the monorepo root; scanning starts at `<repoRoot>/showcase`.
 */
export function runGate(
  repoRoot: string = REPO_ROOT,
  options: {
    allowlist?: AllowlistEntry[];
    config?: DuplicatedConstantsFile;
    ignoreAllowlist?: boolean;
  } = {},
): GateResult {
  const allowlist = options.allowlist ?? loadAllowlist();
  const config = options.config ?? loadDuplicatedConstants();
  const showcaseRoot = path.join(repoRoot, "showcase");

  const files = findTestFiles(showcaseRoot, repoRoot);
  const all: Violation[] = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(repoRoot, rel), "utf8");
    all.push(...scanTestSource(rel, src, config.tunedConstants ?? []));
  }
  all.push(
    ...checkDuplicatedConstants(config.pins, (rel) => {
      const abs = path.join(repoRoot, rel);
      return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    }),
  );

  const found = new Set(all.map(key));
  const allowed = options.ignoreAllowlist
    ? new Set<string>()
    : new Set(allowlist.map(key));

  const stale: AllowlistEntry[] = [];
  const pending: AllowlistEntry[] = [];
  if (!options.ignoreAllowlist) {
    for (const entry of allowlist) {
      if (found.has(key(entry))) continue;
      if (fs.existsSync(path.join(repoRoot, entry.file))) stale.push(entry);
      else pending.push(entry);
    }
  }

  return {
    violations: all.filter((v) => !allowed.has(key(v))),
    all,
    stale,
    pending,
    filesScanned: files.length,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const ignoreAllowlist = argv.includes("--all");
  const started = Date.now();

  let result: GateResult;
  try {
    result = runGate(REPO_ROOT, { ignoreAllowlist });
  } catch (e) {
    console.error(`[ERROR] ${(e as Error).message}`);
    process.exit(2);
  }
  const elapsedMs = Date.now() - started;

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          filesScanned: result.filesScanned,
          elapsedMs,
          violations: result.violations,
          allowlisted: result.all.length - result.violations.length,
          stale: result.stale,
          pending: result.pending,
        },
        null,
        2,
      ),
    );
  } else {
    for (const v of result.violations) {
      console.error(`[FAIL] ${v.file}:${v.line} [${v.rule}] ${v.message}`);
    }
    for (const s of result.stale) {
      console.error(
        `[FAIL] ${s.file} [stale-allowlist] ${s.rule} on \`${s.symbol}\` no longer fires — delete this entry from test-vacuity-allowlist.json (added ${s.added}, owner ${s.owner}).`,
      );
    }
    console.log(
      `Summary: FILES=${result.filesScanned} VIOLATIONS=${result.violations.length} ALLOWLISTED=${result.all.length - result.violations.length} PENDING=${result.pending.length} STALE=${result.stale.length} MS=${elapsedMs}`,
    );
  }

  process.exit(result.violations.length + result.stale.length > 0 ? 1 : 0);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) main();
