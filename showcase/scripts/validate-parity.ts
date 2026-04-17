/**
 * Parity Validator
 *
 * Enforces demo <-> spec <-> QA-markdown parity across all packages under
 * showcase/packages/. For each package:
 *   1. Reads manifest.yaml to extract declared demo IDs.
 *   2. Lists tests/e2e/*.spec.ts files.
 *   3. Lists qa/*.md files.
 *   4. Lists src/app/demos/<id>/ directories.
 *
 * MUST checks (fail -> exit 1):
 *   - manifest.yaml exists and is parseable.
 *   - Every declared demo has a matching src/app/demos/<id>/ directory.
 *
 * SHOULD checks (warn on stderr, do not fail):
 *   - Every declared demo has a matching tests/e2e/<id>.spec.ts.
 *   - Every declared demo has a matching qa/<id>.md.
 *   - Package demo count matches the baseline (default: BASELINE_DEMO_COUNT).
 *   - spec count >= demo count (spec count exceeding demo count is
 *     legitimate — e.g. when a cross-demo spec covers renderer selection
 *     for multiple demos — so only UNDER-coverage is flagged).
 *   - qa count >= demo count.
 *
 * Usage (from showcase/ or showcase/scripts/):
 *   npx tsx scripts/validate-parity.ts
 *   npx tsx scripts/validate-parity.ts --baseline=9
 *   VALIDATE_PARITY_REPO_ROOT=/tmp/fixture npx tsx scripts/validate-parity.ts
 *
 * Exit codes (aligned with audit.ts / validate-pins.ts):
 *   0 — no MUST failures
 *   1 — one or more MUST failures
 *   3 — unreadable (packages dir missing or readdir threw)
 *   4 — internal error (uncaught exception)
 *
 * The script resolves packages relative to its own file location by
 * default, so the invocation cwd does not matter.
 */
/* eslint-disable @typescript-eslint/no-use-before-define */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseManifest,
  type Manifest,
  type ManifestDemo,
} from "./lib/manifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ROOT = showcase/ (NOT the repo root). validate-parity.ts lives at
// showcase/scripts/validate-parity.ts, so path.resolve(__dirname, "..")
// resolves to showcase/. DEFAULT_PACKAGES_DIR is showcase/packages/.
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PACKAGES_DIR = path.join(ROOT, "packages");

/**
 * Baseline expected demo count per package. Packages that deviate from
 * this are flagged as warnings (e.g. ones being built out).
 *
 * RECIPROCAL: the CI workflow .github/workflows/showcase_validate.yml
 * uses `MIN=9` when enforcing the per-package e2e-spec-count floor.
 * Keep these in sync — if one moves, move both.
 */
const BASELINE_DEMO_COUNT = 9;

// Exit code taxonomy mirrors audit.ts / validate-pins.ts so CI callers
// can disambiguate "no anomalies" / "anomalies" / "unreadable" / "internal".
const EXIT_OK = 0;
const EXIT_MUST_FAILURE = 1;
const EXIT_UNREADABLE = 3;
const EXIT_INTERNAL = 4;

// Manifest / ManifestDemo now live in ./lib/manifest.ts. Re-exported below
// for callers that import these types from "../validate-parity.js".
export type { Manifest, ManifestDemo };

/**
 * Typed error raised when `manifest.yaml` exists and could be read but
 * its contents do not form a valid Manifest (YAML syntax error, wrong
 * top-level shape, non-array demos, missing id, etc.). Callers catch
 * with `instanceof ManifestMalformedError` — no string-prefix sniffing.
 */
export class ManifestMalformedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestMalformedError";
  }
}

/**
 * Typed error raised when `manifest.yaml` exists on disk but
 * readFileSync threw (EACCES, I/O race, etc.). Distinct from
 * ManifestMalformedError because the file's contents are not actually
 * known to be invalid. Callers catch with `instanceof
 * ManifestUnreadableError`.
 */
export class ManifestUnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestUnreadableError";
  }
}

/**
 * Tagged union of per-package entries in `mustErrors` / `warnings`. Prior
 * to this type, both fields were bare `string[]` and callers had to
 * substring-sniff to discriminate. The tagged union lets consumers
 * (render, JSON, future filters) switch on `category`.
 */
export type PackageIssue =
  | { category: "missing-manifest"; message: string }
  | { category: "unreadable-manifest"; message: string }
  | { category: "malformed-manifest"; message: string }
  | { category: "missing-demo-dir"; demoId: string; message: string }
  | { category: "missing-spec"; demoId: string; message: string }
  | { category: "missing-qa"; demoId: string; message: string }
  | { category: "baseline-deviation"; message: string }
  | { category: "spec-under-coverage"; message: string }
  | { category: "qa-under-coverage"; message: string }
  | { category: "listing-failed"; path: string; message: string };

export interface PackageReport {
  slug: string;
  demoIds: string[];
  specFiles: string[];
  qaFiles: string[];
  demoDirs: string[];
  mustErrors: PackageIssue[];
  warnings: PackageIssue[];
}

/**
 * Return shape for `listDirs` / `listFiles`. The tuple keeps entries and
 * per-listing warnings correlated without a side-effect parameter —
 * callers merge `warnings` into their PackageReport explicitly.
 */
export interface ListResult {
  entries: string[];
  warnings: PackageIssue[];
}

/**
 * List subdirectories of `p`. Non-existent paths return { entries: [],
 * warnings: [] }. Read errors (EACCES, I/O, etc.) return empty entries
 * AND a `listing-failed` warning so the caller can include it in the
 * PackageReport's `warnings` array. Also logs to stderr so summary
 * counts and stderr output agree.
 */
export function listDirs(p: string): ListResult {
  if (!fs.existsSync(p)) return { entries: [], warnings: [] };
  try {
    const entries = fs
      .readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    return { entries, warnings: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const line = `failed to read directory ${p}: ${msg}`;
    console.error(`[WARN] ${line}`);
    return {
      entries: [],
      warnings: [{ category: "listing-failed", path: p, message: line }],
    };
  }
}

/**
 * List files in `p` with the given suffix. Same error-handling contract
 * as listDirs: missing dir → empty ListResult; read error → empty entries
 * + listing-failed warning, and stderr log.
 */
export function listFiles(p: string, suffix: string): ListResult {
  if (!fs.existsSync(p)) return { entries: [], warnings: [] };
  try {
    const entries = fs
      .readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(suffix))
      .map((d) => d.name)
      .sort();
    return { entries, warnings: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const line = `failed to read directory ${p}: ${msg}`;
    console.error(`[WARN] ${line}`);
    return {
      entries: [],
      warnings: [{ category: "listing-failed", path: p, message: line }],
    };
  }
}

/**
 * Load and parse a package's manifest.yaml.
 *
 * Returns:
 *   - null if the file does not exist ("missing manifest" — caller flags).
 *   - the parsed Manifest on success.
 *
 * Throws:
 *   - `ManifestMalformedError` — file exists but YAML shape is invalid;
 *   - `ManifestUnreadableError` — readFileSync failed (permissions, I/O
 *     race).
 *   Callers discriminate with `instanceof` (see auditPackage).
 *
 * Delegates to lib/manifest.ts :: parseManifest for shape validation so
 * audit.ts / validate-pins.ts / validate-parity.ts apply identical rules.
 */
export function loadManifest(
  slug: string,
  packagesDir: string = DEFAULT_PACKAGES_DIR,
): Manifest | null {
  const manifestPath = path.join(packagesDir, slug, "manifest.yaml");
  const parsed = parseManifest(manifestPath);
  switch (parsed.kind) {
    case "missing":
      return null;
    case "ok":
      return parsed.manifest;
    case "malformed":
      throw new ManifestMalformedError(parsed.error);
    case "unreadable":
      throw new ManifestUnreadableError(parsed.error);
  }
}

export function auditPackage(
  slug: string,
  packagesDir: string = DEFAULT_PACKAGES_DIR,
  baselineDemoCount: number = BASELINE_DEMO_COUNT,
): PackageReport {
  const pkgDir = path.join(packagesDir, slug);
  const mustErrors: PackageIssue[] = [];
  const warnings: PackageIssue[] = [];

  let manifest: Manifest | null;
  try {
    manifest = loadManifest(slug, packagesDir);
  } catch (err) {
    // Distinguish unreadable from malformed via typed error classes —
    // parseManifest is the single source of truth for the classification,
    // loadManifest wraps that in ManifestMalformedError /
    // ManifestUnreadableError, and we match on the class here.
    if (err instanceof ManifestUnreadableError) {
      mustErrors.push({
        category: "unreadable-manifest",
        message: `unreadable manifest.yaml: ${err.message}`,
      });
    } else if (err instanceof ManifestMalformedError) {
      mustErrors.push({
        category: "malformed-manifest",
        message: `unparseable manifest.yaml: ${err.message}`,
      });
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      mustErrors.push({
        category: "malformed-manifest",
        message: `unparseable manifest.yaml: ${msg}`,
      });
    }
    return {
      slug,
      demoIds: [],
      specFiles: [],
      qaFiles: [],
      demoDirs: [],
      mustErrors,
      warnings,
    };
  }

  if (!manifest) {
    mustErrors.push({
      category: "missing-manifest",
      message: `missing manifest.yaml`,
    });
    return {
      slug,
      demoIds: [],
      specFiles: [],
      qaFiles: [],
      demoDirs: [],
      mustErrors,
      warnings,
    };
  }

  // Shape validation (top-level mapping, demos array-of-objects-with-id,
  // etc.) is performed by parseManifest in ./lib/manifest.ts. By the
  // time we reach this point, `manifest.demos` (if set) is guaranteed
  // to be `ManifestDemo[]` with string `id` on every entry — no need
  // to re-guard here.
  const demos = manifest.demos ?? [];
  const demoIds = demos.map((d) => d.id);

  const specResult = listFiles(path.join(pkgDir, "tests", "e2e"), ".spec.ts");
  const qaResult = listFiles(path.join(pkgDir, "qa"), ".md");
  const demoDirResult = listDirs(path.join(pkgDir, "src", "app", "demos"));
  warnings.push(
    ...specResult.warnings,
    ...qaResult.warnings,
    ...demoDirResult.warnings,
  );

  const specFiles = specResult.entries;
  const qaFiles = qaResult.entries;
  const demoDirs = demoDirResult.entries;

  const demoDirSet = new Set(demoDirs);
  const specIdSet = new Set(specFiles.map((f) => f.replace(/\.spec\.ts$/, "")));
  const qaIdSet = new Set(qaFiles.map((f) => f.replace(/\.md$/, "")));

  // MUST: every declared demo has a demos/<id>/ directory
  for (const id of demoIds) {
    if (!demoDirSet.has(id)) {
      mustErrors.push({
        category: "missing-demo-dir",
        demoId: id,
        message: `demo '${id}' declared in manifest but no src/app/demos/${id}/ directory`,
      });
    }
  }

  // SHOULD: every declared demo has a spec file
  for (const id of demoIds) {
    if (!specIdSet.has(id)) {
      warnings.push({
        category: "missing-spec",
        demoId: id,
        message: `demo '${id}' has no tests/e2e/${id}.spec.ts`,
      });
    }
  }

  // SHOULD: every declared demo has a QA doc
  for (const id of demoIds) {
    if (!qaIdSet.has(id)) {
      warnings.push({
        category: "missing-qa",
        demoId: id,
        message: `demo '${id}' has no qa/${id}.md`,
      });
    }
  }

  // SHOULD: demo count matches baseline
  if (demoIds.length !== baselineDemoCount) {
    warnings.push({
      category: "baseline-deviation",
      message: `demo count ${demoIds.length} deviates from baseline ${baselineDemoCount}`,
    });
  }

  // SHOULD: spec count >= demo count. Spec count EXCEEDING demo count is
  // legitimate (e.g. a cross-demo spec covers renderer selection for
  // multiple demos and is intentionally not tied to a single declared
  // demo), so we only warn on UNDER-coverage.
  if (specFiles.length < demoIds.length) {
    warnings.push({
      category: "spec-under-coverage",
      message: `spec count ${specFiles.length} < demo count ${demoIds.length}`,
    });
  }

  // SHOULD: qa count >= demo count
  if (qaFiles.length < demoIds.length) {
    warnings.push({
      category: "qa-under-coverage",
      message: `qa count ${qaFiles.length} < demo count ${demoIds.length}`,
    });
  }

  return {
    slug,
    demoIds,
    specFiles,
    qaFiles,
    demoDirs,
    mustErrors,
    warnings,
  };
}

interface MainOptions {
  /**
   * Override for the expected demo count per package. Must be a positive
   * integer (> 0). NaN / non-integer / non-positive values are rejected
   * by `main()` / `runParity()` before they reach `auditPackage`.
   */
  baseline?: number;
}

/**
 * Validate a candidate baseline value. Returns the integer on success,
 * or null for any non-finite / non-integer / non-positive value. Used
 * to guard both `--baseline=N` CLI parsing and
 * `VALIDATE_PARITY_BASELINE` env-var parsing.
 */
function coerceBaseline(raw: unknown): number | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw <= 0) {
      return null;
    }
    return raw;
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // Explicit digits-only check — Number("0x10") / Number("1e2") /
  // Number(" 9 ") would all accept otherwise. Reject leading + and
  // anything with a decimal point too.
  if (!/^[1-9]\d*$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseMainArgs(argv: string[]): MainOptions {
  const opts: MainOptions = {};
  for (const a of argv) {
    // Match anything after --baseline= (including non-digits) so we can
    // emit a clear error, rather than silently ignoring e.g.
    // `--baseline=abc`.
    const m = /^--baseline=(.*)$/.exec(a);
    if (m) {
      const coerced = coerceBaseline(m[1]);
      if (coerced === null) {
        throw new Error(
          `invalid --baseline value "${m[1]}" (expected a positive integer)`,
        );
      }
      opts.baseline = coerced;
    }
  }
  return opts;
}

// Header format for the pass/summary table. Column widths are centralised
// here (not repeated as magic numbers in the divider) so adding/removing
// columns doesn't require hand-editing a sum further down. Consumers call
// formatHeader / formatRow / computeDividerWidth.
const HEADER_COLUMNS = [
  { label: "package", width: 0 /* derived from slugs at runtime */ },
  { label: "status", width: 6 },
  { label: "demos", width: 5 },
  { label: "specs", width: 5 },
  { label: "qa", width: 3 },
  { label: "notes", width: 10 },
] as const;

function buildHeader(slugWidth: number): string {
  const cols = HEADER_COLUMNS.map((c, i) =>
    i === 0 ? "package".padEnd(slugWidth) : c.label.padEnd(c.width),
  );
  return cols.join("  ");
}

/**
 * Core parity run. Returns a numeric exit code instead of calling
 * `process.exit`, so tests and other in-process callers can invoke it
 * without tearing down vitest. The CLI-facing `main()` wrapper (defined
 * below and NOT exported) is what actually calls `process.exit`.
 */
export function runParity(
  packagesDir?: string,
  baselineDemoCount?: number,
): number {
  // Env-var override keyed to this validator (mirrors SHOWCASE_AUDIT_ROOT
  // in audit.ts and VALIDATE_PINS_REPO_ROOT in validate-pins.ts).
  const envRoot = process.env.VALIDATE_PARITY_REPO_ROOT;
  const resolvedPackagesDir =
    packagesDir ??
    (envRoot && envRoot.length > 0
      ? path.join(envRoot, "packages")
      : DEFAULT_PACKAGES_DIR);

  // CLI-flag baseline overrides env default; explicit parameter wins.
  // Both --baseline= and VALIDATE_PARITY_BASELINE are validated as
  // positive integers — NaN / "abc" / "0" / "-1" are rejected with a
  // clear error rather than silently coerced.
  let cliOpts: MainOptions;
  try {
    cliOpts = parseMainArgs(process.argv.slice(2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[FAIL] ${msg}`);
    return EXIT_MUST_FAILURE;
  }

  const envBaseline = process.env.VALIDATE_PARITY_BASELINE;
  let envBaselineCoerced: number | null = null;
  if (envBaseline !== undefined && envBaseline.length > 0) {
    envBaselineCoerced = coerceBaseline(envBaseline);
    if (envBaselineCoerced === null) {
      console.error(
        `[FAIL] invalid VALIDATE_PARITY_BASELINE value "${envBaseline}" (expected a positive integer)`,
      );
      return EXIT_MUST_FAILURE;
    }
  }

  const resolvedBaseline =
    baselineDemoCount ??
    cliOpts.baseline ??
    envBaselineCoerced ??
    BASELINE_DEMO_COUNT;

  if (!fs.existsSync(resolvedPackagesDir)) {
    console.error(
      `[FAIL] packages directory not found: ${resolvedPackagesDir}`,
    );
    return EXIT_UNREADABLE;
  }

  // Readdir on the packages dir can fail with EACCES / I/O — treat that
  // as unreadable (exit 3), not as an internal error. Matches audit.ts
  // behaviour.
  let slugs: string[];
  try {
    slugs = fs
      .readdirSync(resolvedPackagesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[FAIL] could not read packages directory ${resolvedPackagesDir}: ${msg}`,
    );
    return EXIT_UNREADABLE;
  }

  if (slugs.length === 0) {
    console.error(`[FAIL] no packages found under ${resolvedPackagesDir}`);
    return EXIT_MUST_FAILURE;
  }

  const reports = slugs.map((s) =>
    auditPackage(s, resolvedPackagesDir, resolvedBaseline),
  );

  let hasMustFailure = false;
  let totalWarnings = 0;

  const slugWidth = Math.max(
    ...reports.map((r) => r.slug.length),
    "package".length,
  );

  const header = buildHeader(slugWidth);
  console.log(`\n${header}`);
  // Divider width derived from the header string so adding/removing a
  // column doesn't require re-summing magic numbers.
  console.log("-".repeat(header.length));

  for (const r of reports) {
    const status = r.mustErrors.length > 0 ? "FAIL" : "PASS";
    if (r.mustErrors.length > 0) hasMustFailure = true;
    totalWarnings += r.warnings.length;

    const notes =
      r.warnings.length > 0 ? `${r.warnings.length} warning(s)` : "";

    console.log(
      `${r.slug.padEnd(slugWidth)}  [${status}]  ${String(r.demoIds.length).padStart(4)}   ${String(r.specFiles.length).padStart(4)}   ${String(r.qaFiles.length).padStart(3)}  ${notes}`,
    );
  }

  // Emit MUST errors to stderr (failures belong on stderr, not stdout —
  // stdout is reserved for the pass/summary table).
  for (const r of reports) {
    for (const issue of r.mustErrors) {
      console.error(`[FAIL] ${r.slug}: ${issue.message}`);
    }
  }

  // Emit warnings to stderr
  for (const r of reports) {
    for (const w of r.warnings) {
      console.error(`[WARN] ${r.slug}: ${w.message}`);
    }
  }

  console.log(
    `\n${reports.length} package(s) checked, ${reports.filter((r) => r.mustErrors.length === 0).length} pass, ${reports.filter((r) => r.mustErrors.length > 0).length} fail, ${totalWarnings} warning(s)`,
  );

  return hasMustFailure ? EXIT_MUST_FAILURE : EXIT_OK;
}

/**
 * CLI entrypoint. File-internal (NOT exported) because it calls
 * process.exit — callers who want to unit-test or compose the validator
 * should use `runParity` which returns a numeric exit code.
 */
function main(packagesDir?: string, baselineDemoCount?: number): void {
  const code = runParity(packagesDir, baselineDemoCount);
  process.exit(code);
}

// Only invoke main() when this file is run directly (not when imported by
// tests). Matches the isMain guard pattern used by audit.ts — resolve
// BOTH sides so tsx/pnpm realpath quirks (symlinks, non-canonical argv[1])
// don't break the comparison.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  try {
    main();
  } catch (err) {
    // Top-level safety net: surface internal errors with a distinct exit
    // code so they are distinguishable from legitimate MUST failures
    // (exit 1) and from unreadable infrastructure failures (exit 3).
    const msg = err instanceof Error ? err.stack || err.message : String(err);
    console.error(`[INTERNAL ERROR] validate-parity crashed: ${msg}`);
    process.exit(EXIT_INTERNAL);
  }
}
