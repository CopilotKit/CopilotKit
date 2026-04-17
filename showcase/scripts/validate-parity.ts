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
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PACKAGES_DIR = path.join(ROOT, "packages");

/**
 * Baseline expected demo count per package. Packages that deviate from
 * this are flagged as warnings (e.g. ones still being built out).
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
// for callers that still import these types from "../validate-parity.js".
export type { Manifest, ManifestDemo };

export interface PackageReport {
  slug: string;
  demoIds: string[];
  specFiles: string[];
  qaFiles: string[];
  demoDirs: string[];
  mustErrors: string[];
  warnings: string[];
}

/**
 * List subdirectories of `p`. Non-existent paths return []. Read errors
 * (EACCES, I/O, etc.) return [] AND push a warning into `warnings` so the
 * caller can include it in the PackageReport's `warnings` array. This is
 * in addition to the stderr log — summary counts and stderr must agree.
 */
export function listDirs(p: string, warnings?: string[]): string[] {
  if (!fs.existsSync(p)) return [];
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const line = `failed to read directory ${p}: ${msg}`;
    console.error(`[WARN] ${line}`);
    warnings?.push(line);
    return [];
  }
}

/**
 * List files in `p` with the given suffix. Same error-handling contract
 * as listDirs: missing dir → []; read error → [] + warning pushed into
 * `warnings` (if provided) and logged to stderr.
 */
export function listFiles(
  p: string,
  suffix: string,
  warnings?: string[],
): string[] {
  if (!fs.existsSync(p)) return [];
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(suffix))
      .map((d) => d.name)
      .sort();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const line = `failed to read directory ${p}: ${msg}`;
    console.error(`[WARN] ${line}`);
    warnings?.push(line);
    return [];
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
 *   - An Error tagged with a prefix so callers can distinguish the cause:
 *     "[malformed] ..."  → file exists but YAML shape is invalid;
 *     "[unreadable] ..." → readFileSync failed (permissions, I/O race).
 *   The tagged throw is preserved for backwards compatibility with
 *   existing call sites that use a single try/catch and want to surface
 *   a per-package mustError. `auditPackage` parses the prefix to emit
 *   distinct error messages.
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
      throw new Error(`[malformed] ${parsed.error}`);
    case "unreadable":
      throw new Error(`[unreadable] ${parsed.error}`);
  }
}

export function auditPackage(
  slug: string,
  packagesDir: string = DEFAULT_PACKAGES_DIR,
  baselineDemoCount: number = BASELINE_DEMO_COUNT,
): PackageReport {
  const pkgDir = path.join(packagesDir, slug);
  const mustErrors: string[] = [];
  const warnings: string[] = [];

  let manifest: Manifest | null;
  try {
    manifest = loadManifest(slug, packagesDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // loadManifest throws tagged errors so we can distinguish unreadable
    // from malformed here and emit different messages. parseManifest is
    // the single source of truth for the classification.
    if (msg.startsWith("[unreadable]")) {
      mustErrors.push(
        `unreadable manifest.yaml: ${msg.slice("[unreadable]".length).trim()}`,
      );
    } else if (msg.startsWith("[malformed]")) {
      mustErrors.push(
        `unparseable manifest.yaml: ${msg.slice("[malformed]".length).trim()}`,
      );
    } else {
      mustErrors.push(`unparseable manifest.yaml: ${msg}`);
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
    mustErrors.push(`missing manifest.yaml`);
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

  const specFiles = listFiles(
    path.join(pkgDir, "tests", "e2e"),
    ".spec.ts",
    warnings,
  );
  const qaFiles = listFiles(path.join(pkgDir, "qa"), ".md", warnings);
  const demoDirs = listDirs(path.join(pkgDir, "src", "app", "demos"), warnings);

  const demoDirSet = new Set(demoDirs);
  const specIdSet = new Set(specFiles.map((f) => f.replace(/\.spec\.ts$/, "")));
  const qaIdSet = new Set(qaFiles.map((f) => f.replace(/\.md$/, "")));

  // MUST: every declared demo has a demos/<id>/ directory
  for (const id of demoIds) {
    if (!demoDirSet.has(id)) {
      mustErrors.push(
        `demo '${id}' declared in manifest but no src/app/demos/${id}/ directory`,
      );
    }
  }

  // SHOULD: every declared demo has a spec file
  for (const id of demoIds) {
    if (!specIdSet.has(id)) {
      warnings.push(`demo '${id}' has no tests/e2e/${id}.spec.ts`);
    }
  }

  // SHOULD: every declared demo has a QA doc
  for (const id of demoIds) {
    if (!qaIdSet.has(id)) {
      warnings.push(`demo '${id}' has no qa/${id}.md`);
    }
  }

  // SHOULD: demo count matches baseline
  if (demoIds.length !== baselineDemoCount) {
    warnings.push(
      `demo count ${demoIds.length} deviates from baseline ${baselineDemoCount}`,
    );
  }

  // SHOULD: spec count >= demo count. Spec count EXCEEDING demo count is
  // legitimate (e.g. a cross-demo spec covers renderer selection for
  // multiple demos and is intentionally not tied to a single declared
  // demo), so we only warn on UNDER-coverage.
  if (specFiles.length < demoIds.length) {
    warnings.push(
      `spec count ${specFiles.length} < demo count ${demoIds.length}`,
    );
  }

  // SHOULD: qa count >= demo count
  if (qaFiles.length < demoIds.length) {
    warnings.push(`qa count ${qaFiles.length} < demo count ${demoIds.length}`);
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
  baseline?: number;
}

function parseMainArgs(argv: string[]): MainOptions {
  const opts: MainOptions = {};
  for (const a of argv) {
    const m = /^--baseline=(\d+)$/.exec(a);
    if (m) {
      opts.baseline = Number(m[1]);
    }
  }
  return opts;
}

export function main(packagesDir?: string, baselineDemoCount?: number): void {
  // Env-var override keyed to this validator (mirrors SHOWCASE_AUDIT_ROOT
  // in audit.ts and VALIDATE_PINS_REPO_ROOT in validate-pins.ts).
  const envRoot = process.env.VALIDATE_PARITY_REPO_ROOT;
  const resolvedPackagesDir =
    packagesDir ??
    (envRoot && envRoot.length > 0
      ? path.join(envRoot, "packages")
      : DEFAULT_PACKAGES_DIR);

  // CLI-flag baseline overrides env default; explicit parameter still wins.
  const cliOpts = parseMainArgs(process.argv.slice(2));
  const envBaseline = process.env.VALIDATE_PARITY_BASELINE;
  const resolvedBaseline =
    baselineDemoCount ??
    cliOpts.baseline ??
    (envBaseline ? Number(envBaseline) : BASELINE_DEMO_COUNT);

  if (!fs.existsSync(resolvedPackagesDir)) {
    console.error(
      `[FAIL] packages directory not found: ${resolvedPackagesDir}`,
    );
    process.exit(EXIT_UNREADABLE);
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
    process.exit(EXIT_UNREADABLE);
  }

  if (slugs.length === 0) {
    console.error(`[FAIL] no packages found under ${resolvedPackagesDir}`);
    process.exit(EXIT_MUST_FAILURE);
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

  console.log(
    `\n${"package".padEnd(slugWidth)}  status  demos  specs  qa   notes`,
  );
  console.log("-".repeat(slugWidth + 2 + 8 + 7 + 7 + 5 + 10));

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
    for (const err of r.mustErrors) {
      console.error(`[FAIL] ${r.slug}: ${err}`);
    }
  }

  // Emit warnings to stderr
  for (const r of reports) {
    for (const w of r.warnings) {
      console.error(`[WARN] ${r.slug}: ${w}`);
    }
  }

  console.log(
    `\n${reports.length} package(s) checked, ${reports.filter((r) => r.mustErrors.length === 0).length} pass, ${reports.filter((r) => r.mustErrors.length > 0).length} fail, ${totalWarnings} warning(s)`,
  );

  process.exit(hasMustFailure ? EXIT_MUST_FAILURE : EXIT_OK);
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
