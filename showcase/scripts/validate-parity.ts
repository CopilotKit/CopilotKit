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
 *   2 — invalid CLI input (bad --baseline / VALIDATE_PARITY_BASELINE)
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
 * reads `baselineDemoCount` from showcase/scripts/fail-baseline.json
 * when enforcing the per-package e2e-spec-count floor — there is no
 * hardcoded MIN in the workflow anymore. Keep this default in sync
 * with `baselineDemoCount` in fail-baseline.json; if one moves,
 * move both. The sync is enforced by
 * __tests__/baseline-sync.test.ts so drift is caught in CI rather than
 * relying on the comment above.
 */
export const BASELINE_DEMO_COUNT = 9;

// Exit code taxonomy mirrors audit.ts / validate-pins.ts so CI callers
// can disambiguate "no anomalies" / "anomalies" / "unreadable" / "internal".
// `as const` narrows each to its literal type so the union below
// (`ValidateParityExitCode`) is a literal union — guarding callers that
// switch on the value from accidentally matching arbitrary numbers.
const EXIT_OK = 0 as const;
const EXIT_MUST_FAILURE = 1 as const;
const EXIT_INVALID_INPUT = 2 as const;
const EXIT_UNREADABLE = 3 as const;
const EXIT_INTERNAL = 4 as const;

/**
 * Literal union of every exit code `runParity` can return. Exposed so
 * in-process callers (tests, composed CLIs) can pattern-match against
 * the taxonomy without re-declaring magic numbers.
 */
export type ValidateParityExitCode =
  | typeof EXIT_OK
  | typeof EXIT_MUST_FAILURE
  | typeof EXIT_INVALID_INPUT
  | typeof EXIT_UNREADABLE
  | typeof EXIT_INTERNAL;

/**
 * Render an error (and any nested `.cause` chain) for stderr. Walks the
 * cause chain depth-first and indents each successive cause so operators
 * see both the outer wrapping context (e.g. "audit of <slug> crashed")
 * AND the root-cause message/stack without rebuilding the chain by hand.
 * Rendering only `err.stack || err.message` drops the chain entirely
 * because `Error#stack` does NOT include causes — this helper is the
 * missing piece.
 *
 * Guards against pathological or malicious cyclic cause graphs by
 * tracking visited references and capping depth — a self-referential
 * `.cause` (or a long synthetic chain) can't hang the validator.
 */
function formatErrorChain(err: unknown): string {
  const MAX_DEPTH = 16;
  const seen = new WeakSet<object>();
  const lines: string[] = [];

  const render = (e: unknown): string =>
    e instanceof Error ? e.stack || e.message : String(e);

  let current: unknown = err;
  let depth = 0;
  while (current !== undefined && current !== null && depth < MAX_DEPTH) {
    const prefix = depth === 0 ? "" : `${"  ".repeat(depth)}caused by: `;
    lines.push(
      prefix + render(current).replace(/\n/g, `\n${"  ".repeat(depth)}`),
    );

    if (typeof current !== "object") break;
    if (seen.has(current as object)) {
      lines.push(`${"  ".repeat(depth + 1)}[cyclic cause — stopping]`);
      break;
    }
    seen.add(current as object);

    const next = (current as { cause?: unknown }).cause;
    if (next === undefined) break;
    current = next;
    depth++;
  }

  if (depth === MAX_DEPTH) {
    lines.push(
      `${"  ".repeat(depth + 1)}[cause chain truncated at depth ${MAX_DEPTH}]`,
    );
  }

  return lines.join("\n");
}

// Re-exported for test callers importing these types from
// "../validate-parity.js"; the canonical definitions live in
// ./lib/manifest.ts.
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
 * Thrown by `auditPackage` when called with an invalid baseline value
 * (non-positive, non-integer, NaN, Infinity). Defence-in-depth: the
 * CLI wrapper validates via coerceBaseline, but direct programmatic
 * callers of auditPackage should also fail fast rather than silently
 * comparing against NaN / 0.
 */
export class InvalidBaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBaselineError";
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
 * Tagged union of per-package entries in `mustErrors` / `warnings`. Each
 * variant carries only the structured fields the category needs.
 * Categories that want a user-facing string render via `deriveMessage`
 * at display time so the struct has a single source of truth — no
 * pre-formatted `message` field duplicating the structured data.
 */
export type PackageIssue =
  | { category: "missing-manifest" }
  | { category: "unreadable-manifest"; error: string }
  | { category: "malformed-manifest"; error: string }
  | { category: "missing-demo-dir"; demoId: string }
  | { category: "unreadable-demos-dir"; path: string; error: string }
  | { category: "unreadable-specs-dir"; path: string; error: string }
  | { category: "unreadable-qa-dir"; path: string; error: string }
  | { category: "missing-spec"; demoId: string }
  | { category: "missing-qa"; demoId: string }
  | { category: "baseline-deviation"; demoCount: number; baseline: number }
  | {
      category: "spec-under-coverage";
      specCount: number;
      demoCount: number;
    }
  | { category: "qa-under-coverage"; qaCount: number; demoCount: number }
  | { category: "listing-failed"; path: string; error: string }
  | { category: "crashed"; error: string };

/**
 * Render a PackageIssue as a user-facing string. Kept as the single
 * source of truth for issue rendering so the stderr emitter, JSON
 * summary, and any future consumer produce identical text.
 *
 * Using a discriminated union + exhaustive switch keeps this
 * future-proof — adding a new PackageIssue variant without a matching
 * case here is a TypeScript error.
 */
export function deriveMessage(issue: PackageIssue): string {
  switch (issue.category) {
    case "missing-manifest":
      return "missing manifest.yaml";
    case "unreadable-manifest":
      return `unreadable manifest.yaml: ${issue.error}`;
    case "malformed-manifest":
      return `unparseable manifest.yaml: ${issue.error}`;
    case "missing-demo-dir":
      return `demo '${issue.demoId}' declared in manifest but no demos/${issue.demoId}/ (or legacy src/app/demos/${issue.demoId}/) directory`;
    case "unreadable-demos-dir":
      return `unreadable demos directory: failed to read directory ${issue.path}: ${issue.error}`;
    case "unreadable-specs-dir":
      return `unreadable specs directory: failed to read directory ${issue.path}: ${issue.error}`;
    case "unreadable-qa-dir":
      return `unreadable qa directory: failed to read directory ${issue.path}: ${issue.error}`;
    case "missing-spec":
      return `demo '${issue.demoId}' has no tests/e2e/${issue.demoId}.spec.ts`;
    case "missing-qa":
      return `demo '${issue.demoId}' has no qa/${issue.demoId}.md`;
    case "baseline-deviation":
      return `demo count ${issue.demoCount} deviates from baseline ${issue.baseline}`;
    case "spec-under-coverage":
      return `spec count ${issue.specCount} < demo count ${issue.demoCount}`;
    case "qa-under-coverage":
      return `qa count ${issue.qaCount} < demo count ${issue.demoCount}`;
    case "listing-failed":
      return `failed to read directory ${issue.path}: ${issue.error}`;
    case "crashed":
      return `audit crashed: ${issue.error}`;
  }
}

export interface PackageReport {
  readonly slug: string;
  // All arrays are `readonly` uniformly: surface any accidental post-
  // return push/splice as a compile error. Callers that need a mutable
  // copy should clone. Marking mustErrors/warnings readonly while
  // leaving demoIds/specFiles/qaFiles/demoDirs mutable would be an
  // asymmetric contract and invites drift.
  readonly demoIds: readonly string[];
  readonly specFiles: readonly string[];
  readonly qaFiles: readonly string[];
  readonly demoDirs: readonly string[];
  readonly mustErrors: readonly PackageIssue[];
  readonly warnings: readonly PackageIssue[];
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
 * Best-effort "does this path exist and is it readable" probe used by
 * listDirs/listFiles to distinguish genuinely-missing paths (ENOENT
 * → silent, return empty) from permission/I/O failures (EACCES et al
 * → surface as listing-failed so the caller can escalate).
 *
 * `fs.existsSync` CONFLATES these: it returns false for ENOENT AND for
 * EACCES (and every other statSync failure), so a package whose
 * tests/e2e/ is chmod 0 silently registers as "no tests/e2e/" and the
 * whole per-slug cascade gets suppressed. That's the bug this probe
 * exists to close — do NOT replace with existsSync.
 *
 * ENOTDIR handling: ENOTDIR from statSync means "a component of the
 * path is a regular file, not a directory" (e.g. stray file committed
 * at packages/foo/tests so walking to packages/foo/tests/e2e fails).
 * That is a misconfiguration signal, NOT a legitimately-absent
 * directory. Classifying it as `missing` silently drops the whole
 * subtree from parity checks with zero diagnostic. Instead, surface
 * it as `unreadable` so the caller emits a listing-failed warning
 * and callers upstream can escalate (unreadable-demos-dir / etc.).
 *
 * Return value:
 *   { kind: "missing" }    — ENOENT only
 *   { kind: "ok" }         — stat succeeded (target may be dir or file; caller decides)
 *   { kind: "unreadable"; error: string } — ENOTDIR or any other statSync failure
 */
type ProbeResult =
  | { kind: "missing" }
  | { kind: "ok" }
  | { kind: "unreadable"; error: string };

function probeDir(p: string): ProbeResult {
  try {
    // Deliberately do NOT check isDirectory() here — a non-directory
    // at the path (regular file / socket / etc.) should flow through
    // to the caller's readdirSync, which will throw ENOTDIR and land
    // in the existing listing-failed / "could not read" path. Doing
    // the isDirectory check here would reclassify "file at
    // packages/" as "missing" and produce a confusing "not found"
    // diagnostic when the real problem is ENOTDIR.
    fs.statSync(p);
    return { kind: "ok" };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return { kind: "missing" };
    // ENOTDIR (a path component is a regular file) is a
    // misconfiguration, not a legitimately-absent path — surface it
    // as unreadable so it becomes a listing-failed warning rather
    // than a silent empty result.
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "unreadable", error: msg };
  }
}

/**
 * List subdirectories of `p`. Non-existent paths (ENOENT) return
 * { entries: [], warnings: [] }. Read/permission errors (EACCES, I/O,
 * etc.) return empty entries AND a `listing-failed` warning so the
 * caller can include it in the PackageReport's `warnings` array. The
 * caller is responsible for emitting the stderr `[WARN]` line via
 * deriveMessage — helpers do NOT log directly, otherwise operators
 * see a duplicated warning line (once from the helper, once from the
 * caller's iteration over `warnings[]`).
 *
 * NB: uses `statSync` (not `existsSync`) to distinguish ENOENT from
 * EACCES — see probeDir docstring for why that matters.
 */
export function listDirs(p: string): ListResult {
  const probe = probeDir(p);
  if (probe.kind === "missing") return { entries: [], warnings: [] };
  if (probe.kind === "unreadable") {
    const issue: PackageIssue = {
      category: "listing-failed",
      path: p,
      error: probe.error,
    };
    return { entries: [], warnings: [issue] };
  }
  try {
    const entries = fs
      .readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    return { entries, warnings: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const issue: PackageIssue = {
      category: "listing-failed",
      path: p,
      error: msg,
    };
    return { entries: [], warnings: [issue] };
  }
}

/**
 * List files in `p` with the given suffix. Same error-handling contract
 * as listDirs: ENOENT → empty ListResult; EACCES / other stat failure
 * → empty entries + listing-failed warning. Caller emits the stderr
 * `[WARN]` line.
 *
 * Bare-suffix filenames (e.g. a file literally named `.spec.ts` or
 * `.md`) are silently skipped: after stripping the suffix they would
 * map to an empty demo-id and could accidentally match a declared demo
 * on the empty-string side of the Set comparison. Such files aren't a
 * legitimate package-layout artefact, so dropping them is quieter and
 * safer than warning about them.
 *
 * NB: uses `statSync` (not `existsSync`) to distinguish ENOENT from
 * EACCES — see probeDir docstring.
 */
export function listFiles(p: string, suffix: string): ListResult {
  const probe = probeDir(p);
  if (probe.kind === "missing") return { entries: [], warnings: [] };
  if (probe.kind === "unreadable") {
    const issue: PackageIssue = {
      category: "listing-failed",
      path: p,
      error: probe.error,
    };
    return { entries: [], warnings: [issue] };
  }
  try {
    const entries = fs
      .readdirSync(p, { withFileTypes: true })
      .filter((d) => {
        if (!d.isFile()) return false;
        if (!d.name.endsWith(suffix)) return false;
        // Reject files whose entire name IS the suffix (stem length 0).
        return d.name.length > suffix.length;
      })
      .map((d) => d.name)
      .sort();
    return { entries, warnings: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const issue: PackageIssue = {
      category: "listing-failed",
      path: p,
      error: msg,
    };
    return { entries: [], warnings: [issue] };
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
  // Pass the directory slug to parseManifest so its slug-mismatch
  // guard fires: if the manifest's `slug:` field disagrees with the
  // directory on disk, we get a shape-malformed result instead of
  // silently validating a copy-paste / rename mistake.
  const parsed = parseManifest(manifestPath, slug);
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
  // Defence-in-depth: runParity validates baseline via coerceBaseline,
  // but auditPackage is exported for direct use by tests / future
  // callers. A NaN / 0 / negative / non-integer baseline silently
  // produces nonsense `demoIds.length !== baseline` warnings otherwise.
  if (
    typeof baselineDemoCount !== "number" ||
    !Number.isFinite(baselineDemoCount) ||
    !Number.isInteger(baselineDemoCount) ||
    baselineDemoCount <= 0
  ) {
    throw new InvalidBaselineError(
      `baselineDemoCount must be a positive integer, got ${String(baselineDemoCount)}`,
    );
  }

  const pkgDir = path.join(packagesDir, slug);
  const mustErrors: PackageIssue[] = [];
  const warnings: PackageIssue[] = [];

  // Pre-compute spec/qa/demo-dir listings up-front so the reporter row
  // still shows accurate counts even if manifest parsing fails. MUST
  // errors still gate the exit code — this only affects the table.
  //
  // Demos can live at either <pkg>/demos/<cell>/ (per-column container
  // layout with one folder per cell containing frontend/ + backend/) OR
  // <pkg>/src/app/demos/<cell>/ (legacy shared-tree layout). Union the
  // two listings so the check is permissive during the transition — a
  // cell declared in manifest passes as long as either directory exists.
  const specResult = listFiles(path.join(pkgDir, "tests", "e2e"), ".spec.ts");
  const qaResult = listFiles(path.join(pkgDir, "qa"), ".md");
  const topLevelDemosDir = path.join(pkgDir, "demos");
  const legacyDemosDir = path.join(pkgDir, "src", "app", "demos");
  const topLevelDemoDirResult = listDirs(topLevelDemosDir);
  const legacyDemoDirResult = listDirs(legacyDemosDir);
  const demoDirResult: ListResult = {
    entries: Array.from(
      new Set([
        ...topLevelDemoDirResult.entries,
        ...legacyDemoDirResult.entries,
      ]),
    ),
    warnings: [
      // Only emit listing warnings if NEITHER directory is readable — a
      // missing top-level demos/ is normal for columns still on the
      // legacy layout, and vice versa.
      ...(topLevelDemoDirResult.entries.length === 0 &&
      legacyDemoDirResult.entries.length === 0
        ? [...topLevelDemoDirResult.warnings, ...legacyDemoDirResult.warnings]
        : []),
    ],
  };

  const specFiles = specResult.entries;
  const qaFiles = qaResult.entries;
  const demoDirs = demoDirResult.entries;

  // When src/app/demos/, tests/e2e/, or qa/ is unreadable, elevate to a
  // MUST error under category "unreadable-{demos,specs,qa}-dir" and
  // SUPPRESS the downstream missing-{demo-dir,spec,qa} cascade so the
  // EACCES root cause isn't buried. We detect this by checking whether
  // the respective list call returned a listing-failed warning for the
  // target path specifically (not an unrelated path).
  // For the unreadable-demos-dir elevation, accept a listing-failed
  // warning at EITHER candidate path (new top-level demos/ or legacy
  // src/app/demos/). Report the failing path verbatim so the operator
  // sees which location couldn't be read.
  const specsDirPath = path.join(pkgDir, "tests", "e2e");
  const qaDirPath = path.join(pkgDir, "qa");
  const findListingFailed = (
    result: ListResult,
    target: string,
  ): Extract<PackageIssue, { category: "listing-failed" }> | undefined =>
    result.warnings.find(
      (w): w is Extract<PackageIssue, { category: "listing-failed" }> =>
        w.category === "listing-failed" && w.path === target,
    );
  const demosDirUnreadable =
    findListingFailed(demoDirResult, topLevelDemosDir) ??
    findListingFailed(demoDirResult, legacyDemosDir);
  const demosDirPath = demosDirUnreadable?.path ?? topLevelDemosDir;
  const specsDirUnreadable = findListingFailed(specResult, specsDirPath);
  const qaDirUnreadable = findListingFailed(qaResult, qaDirPath);

  // Merge listing warnings only when the underlying path was NOT elevated
  // to a MUST error. For the elevated paths, push the typed MUST variant
  // so consumers see a single authoritative signal instead of a warning
  // plus N cascaded per-demo errors.
  if (!specsDirUnreadable) {
    warnings.push(...specResult.warnings);
  } else {
    mustErrors.push({
      category: "unreadable-specs-dir",
      path: specsDirPath,
      error: specsDirUnreadable.error,
    });
  }
  if (!qaDirUnreadable) {
    warnings.push(...qaResult.warnings);
  } else {
    mustErrors.push({
      category: "unreadable-qa-dir",
      path: qaDirPath,
      error: qaDirUnreadable.error,
    });
  }
  if (!demosDirUnreadable) {
    warnings.push(...demoDirResult.warnings);
  } else {
    mustErrors.push({
      category: "unreadable-demos-dir",
      path: demosDirPath,
      error: demosDirUnreadable.error,
    });
  }

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
        error: err.message,
      });
    } else if (err instanceof ManifestMalformedError) {
      mustErrors.push({
        category: "malformed-manifest",
        error: err.message,
      });
    } else {
      // Unknown error class (TypeError, OOM, bug surfacing from a
      // future loadManifest refactor, etc.) — re-throw so the CLI's
      // top-level catch surfaces [INTERNAL ERROR] with EXIT_INTERNAL.
      // Silently bucketing these as malformed-manifest would hide real
      // defects behind a legitimate-looking taxonomy entry. Wrap with
      // the package slug so operators see which package triggered the
      // crash; the original error rides along via `cause` so stacks /
      // errno / etc. remain inspectable.
      // Outer message is context-only — formatErrorChain unfurls `cause`
      // so including the inner message here would render it twice.
      throw new Error(`audit of ${slug} crashed`, { cause: err });
    }
    // Don't early-return: we still return the report with spec/qa/demo
    // dir counts populated so the table row is accurate. MUST error
    // already gates the exit code.
    return {
      slug,
      demoIds: [],
      specFiles,
      qaFiles,
      demoDirs,
      mustErrors,
      warnings,
    };
  }

  if (!manifest) {
    mustErrors.push({ category: "missing-manifest" });
    return {
      slug,
      demoIds: [],
      specFiles,
      qaFiles,
      demoDirs,
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

  const demoDirSet = new Set(demoDirs);
  const specIdSet = new Set(specFiles.map((f) => f.replace(/\.spec\.ts$/, "")));
  const qaIdSet = new Set(qaFiles.map((f) => f.replace(/\.md$/, "")));

  // MUST: every declared demo has a demos/<id>/ directory. Suppressed
  // entirely when the demos/ dir itself is unreadable — a single
  // unreadable-demos-dir MUST is clearer than N cascaded missing-demo-dir
  // errors that all trace to the same EACCES root cause.
  if (!demosDirUnreadable) {
    for (const id of demoIds) {
      if (!demoDirSet.has(id)) {
        mustErrors.push({ category: "missing-demo-dir", demoId: id });
      }
    }
  }

  // SHOULD: every declared demo has a spec file. Suppressed when the
  // tests/e2e/ dir itself is unreadable — a single unreadable-specs-dir
  // MUST is clearer than N cascaded missing-spec warnings that all trace
  // to the same EACCES root cause.
  if (!specsDirUnreadable) {
    for (const id of demoIds) {
      if (!specIdSet.has(id)) {
        warnings.push({ category: "missing-spec", demoId: id });
      }
    }
  }

  // SHOULD: every declared demo has a QA doc. Suppressed when qa/ is
  // unreadable — see unreadable-qa-dir rationale above.
  if (!qaDirUnreadable) {
    for (const id of demoIds) {
      if (!qaIdSet.has(id)) {
        warnings.push({ category: "missing-qa", demoId: id });
      }
    }
  }

  // SHOULD: demo count matches baseline
  if (demoIds.length !== baselineDemoCount) {
    warnings.push({
      category: "baseline-deviation",
      demoCount: demoIds.length,
      baseline: baselineDemoCount,
    });
  }

  // SHOULD: spec count >= demo count. Spec count EXCEEDING demo count is
  // legitimate (e.g. a cross-demo spec covers renderer selection for
  // multiple demos and is intentionally not tied to a single declared
  // demo), so we only warn on UNDER-coverage. Suppressed when the
  // tests/e2e/ dir itself is unreadable — the elevated
  // `unreadable-specs-dir` MUST is the authoritative signal; a spurious
  // "0 < N" coverage warning on top of it would bury the EACCES root
  // cause, same rationale as the per-demo missing-spec suppression above.
  if (!specsDirUnreadable && specFiles.length < demoIds.length) {
    warnings.push({
      category: "spec-under-coverage",
      specCount: specFiles.length,
      demoCount: demoIds.length,
    });
  }

  // SHOULD: qa count >= demo count. Suppressed when qa/ is unreadable —
  // see spec-under-coverage rationale above.
  if (!qaDirUnreadable && qaFiles.length < demoIds.length) {
    warnings.push({
      category: "qa-under-coverage",
      qaCount: qaFiles.length,
      demoCount: demoIds.length,
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
 * Discriminated union of rejection reasons emitted by `coerceBaseline`.
 * Consumers map the reason into a specific diagnostic message so bad
 * input is actionable (e.g. "1.5" → float, "0x10" → hex).
 */
export type CoerceBaselineReason =
  | "empty"
  | "whitespace"
  | "zero"
  | "negative"
  | "float"
  | "hex"
  | "non-numeric";

export type CoerceBaselineResult =
  | { ok: true; value: number }
  | { ok: false; reason: CoerceBaselineReason };

/**
 * Validate a candidate baseline value. Returns a discriminated union so
 * callers can surface a specific reason in user-facing error messages
 * (distinguishing e.g. "1.5" from "0x10" from "abc" matters when the
 * CI operator has to guess what they typed wrong).
 *
 * Used to guard both `--baseline=N` CLI parsing and
 * `VALIDATE_PARITY_BASELINE` env-var parsing.
 */
export function coerceBaseline(raw: unknown): CoerceBaselineResult {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { ok: false, reason: "non-numeric" };
    if (!Number.isInteger(raw)) return { ok: false, reason: "float" };
    if (raw === 0) return { ok: false, reason: "zero" };
    if (raw < 0) return { ok: false, reason: "negative" };
    return { ok: true, value: raw };
  }
  if (typeof raw !== "string") return { ok: false, reason: "non-numeric" };
  if (raw.length === 0) return { ok: false, reason: "empty" };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "whitespace" };
  // Distinguish specific bad shapes so the error message can be clearer.
  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) return { ok: false, reason: "hex" };
  if (/^-\d+$/.test(trimmed)) return { ok: false, reason: "negative" };
  if (/^-?\d+\.\d+$/.test(trimmed)) return { ok: false, reason: "float" };
  if (trimmed === "0" || /^0+$/.test(trimmed))
    return { ok: false, reason: "zero" };
  // Strict digits-only: rejects leading +, exponent (1e2), leading 0,
  // and anything else Number() would otherwise coerce.
  if (!/^[1-9]\d*$/.test(trimmed)) return { ok: false, reason: "non-numeric" };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, reason: "non-numeric" };
  }
  if (n === 0) return { ok: false, reason: "zero" };
  if (n < 0) return { ok: false, reason: "negative" };
  return { ok: true, value: n };
}

function parseMainArgs(argv: string[]): MainOptions {
  const opts: MainOptions = {};
  // Collect all parse errors, mirroring audit.ts parseArgs. Unrecognised
  // arguments (typos like `--basline=10`, space-separated `--baseline 9`,
  // stray positionals) are flagged loudly instead of being silently
  // ignored — otherwise the user thinks they set baseline but the
  // validator uses the default.
  //
  // Track `sawBaseline` and reject duplicate --baseline=. CI shell
  // concatenation is a common source of accidental duplicates and
  // "last wins" silently hides the user's first intent — mirror
  // audit.ts parseArgs which rejects duplicate --json / --slug /
  // --strict / --columns for the same reason.
  const errors: string[] = [];
  let sawBaseline = false;
  for (const a of argv) {
    // Match anything after --baseline= (including non-digits) so we can
    // emit a clear error, rather than silently ignoring e.g.
    // `--baseline=abc`.
    const m = /^--baseline=(.*)$/.exec(a);
    if (m) {
      if (sawBaseline) {
        errors.push(
          `--baseline specified more than once (duplicate value "${m[1]}")`,
        );
        continue;
      }
      sawBaseline = true;
      const coerced = coerceBaseline(m[1]);
      if (!coerced.ok) {
        errors.push(
          `invalid --baseline value "${m[1]}" (${coerced.reason}; expected a positive integer)`,
        );
        continue;
      }
      opts.baseline = coerced.value;
    } else {
      errors.push(`unrecognised argument: ${a}`);
    }
  }
  if (errors.length > 0) {
    // Join all errors so the user sees every problem at once, rather
    // than fixing them one at a time across reruns. Matches audit.ts's
    // error-collection pattern.
    throw new Error(errors.join("; "));
  }
  return opts;
}

/**
 * Column spec for the pass/summary table. Both header and data rows
 * are rendered from this single array so widths can never drift — add
 * or remove a column here and `buildHeader` / `formatRow` both update
 * in lockstep.
 *
 * `width` is the minimum display width for the column. The first
 * column ("package") uses a runtime-derived slug width instead.
 *
 * `align`: "left" → padEnd, "right" → padStart. Numeric columns align
 * right so counts line up visually; string labels align left.
 *
 * `render(report)` projects a PackageReport into its cell string. The
 * same cells are emitted for the header (labels padded to `width`) so
 * both sides are character-for-character identical width per column.
 */
export interface HeaderColumn {
  readonly label: string;
  readonly width: number;
  readonly align: "left" | "right";
  readonly render: (r: PackageReport) => string;
}

export const HEADER_COLUMNS: readonly HeaderColumn[] = [
  {
    label: "package",
    width: 0 /* derived from slugs at runtime */,
    align: "left",
    render: (r) => r.slug,
  },
  {
    label: "status",
    width: 6,
    align: "left",
    render: (r) => (r.mustErrors.length > 0 ? "[FAIL]" : "[PASS]"),
  },
  {
    label: "demos",
    width: 5,
    align: "right",
    render: (r) => String(r.demoIds.length),
  },
  {
    label: "specs",
    width: 5,
    align: "right",
    render: (r) => String(r.specFiles.length),
  },
  {
    label: "qa",
    width: 3,
    align: "right",
    render: (r) => String(r.qaFiles.length),
  },
  {
    label: "notes",
    width: 10,
    align: "left",
    render: (r) => (r.warnings.length > 0 ? `${r.warnings.length} warn` : ""),
  },
] as const;

function padCell(s: string, width: number, align: "left" | "right"): string {
  return align === "right" ? s.padStart(width) : s.padEnd(width);
}

export function buildHeader(slugWidth: number): string {
  const cols = HEADER_COLUMNS.map((c, i) => {
    const w = i === 0 ? slugWidth : c.width;
    return padCell(c.label, w, c.align);
  });
  return cols.join("  ");
}

/**
 * Render a data row using the same column widths and alignment the
 * header uses. Driving both from HEADER_COLUMNS guarantees they stay
 * in sync — changing a width in one place updates both.
 */
export function formatRow(report: PackageReport, slugWidth: number): string {
  const cols = HEADER_COLUMNS.map((c, i) => {
    const w = i === 0 ? slugWidth : c.width;
    return padCell(c.render(report), w, c.align);
  });
  return cols.join("  ");
}

/**
 * Core parity run. Returns a numeric exit code instead of mutating
 * process state, so tests and other in-process callers can invoke it
 * without tearing down vitest. The CLI-facing `main()` wrapper (defined
 * below and NOT exported) sets `process.exitCode` from the return
 * value — neither function calls `process.exit` synchronously, which
 * preserves stdout/stderr drain.
 *
 * This function is the stable in-process boundary: it NEVER throws.
 * Any unexpected exception surfaced from inner helpers (auditPackage,
 * I/O, etc.) is caught, rendered to stderr with the full cause chain,
 * and converted into `EXIT_INTERNAL`. That way in-process callers
 * (tests, composed CLIs) always receive a numeric exit code and can
 * pattern-match on the `ValidateParityExitCode` taxonomy — they don't
 * have to re-implement the top-level try/catch that `main()` uses.
 */
export function runParity(
  packagesDir?: string,
  baselineDemoCount?: number,
): ValidateParityExitCode {
  try {
    return runParityImpl(packagesDir, baselineDemoCount);
  } catch (err) {
    console.error(
      `[INTERNAL ERROR] validate-parity crashed: ${formatErrorChain(err)}`,
    );
    return EXIT_INTERNAL;
  }
}

/**
 * Inner implementation of `runParity`. Separate function (not exported)
 * so the `try/catch` in `runParity` has a crisp body to guard — keeping
 * the boundary at a single call site avoids `return` vs `throw`
 * interleaving if the catch ever grows.
 */
function runParityImpl(
  packagesDir?: string,
  baselineDemoCount?: number,
): ValidateParityExitCode {
  // Env-var override keyed to this validator (mirrors SHOWCASE_AUDIT_ROOT
  // in audit.ts and VALIDATE_PINS_REPO_ROOT in validate-pins.ts).
  const envRoot = process.env.VALIDATE_PARITY_REPO_ROOT;
  const resolvedPackagesDir =
    packagesDir ??
    (envRoot && envRoot.length > 0
      ? path.join(envRoot, "packages")
      : DEFAULT_PACKAGES_DIR);

  // Only read process.argv when invoked from the top-level
  // CLI entrypoint (i.e. when no explicit baseline was passed). In-
  // process callers that hand in an explicit baseline must not have
  // their behaviour perturbed by argv they didn't write. The env var
  // (VALIDATE_PARITY_BASELINE) is also skipped when the caller passes
  // an explicit value — the parameter is the highest-precedence source.
  let cliOpts: MainOptions = {};
  let envBaselineCoerced: number | null = null;
  if (baselineDemoCount === undefined) {
    // CLI-flag baseline overrides env default. Both --baseline= and
    // VALIDATE_PARITY_BASELINE are validated as positive integers —
    // NaN / "abc" / "0" / "-1" are rejected with a clear reason rather
    // than silently coerced.
    try {
      cliOpts = parseMainArgs(process.argv.slice(2));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[FAIL] ${msg}`);
      return EXIT_INVALID_INPUT;
    }

    const envBaseline = process.env.VALIDATE_PARITY_BASELINE;
    if (envBaseline !== undefined && envBaseline.length > 0) {
      const coerced = coerceBaseline(envBaseline);
      if (!coerced.ok) {
        console.error(
          `[FAIL] invalid VALIDATE_PARITY_BASELINE value "${envBaseline}" (${coerced.reason}; expected a positive integer)`,
        );
        return EXIT_INVALID_INPUT;
      }
      envBaselineCoerced = coerced.value;
    }
  }

  const resolvedBaseline =
    baselineDemoCount ??
    cliOpts.baseline ??
    envBaselineCoerced ??
    BASELINE_DEMO_COUNT;

  // Use statSync (not existsSync) so ENOENT and EACCES surface with
  // distinct diagnostics — existsSync returns false in both cases and
  // produces a misleading "not found" message for a perms failure.
  // Both still exit EXIT_UNREADABLE (3), but the operator-facing
  // message is actionable.
  const pkgDirProbe = probeDir(resolvedPackagesDir);
  if (pkgDirProbe.kind === "missing") {
    console.error(
      `[FAIL] packages directory not found: ${resolvedPackagesDir}`,
    );
    return EXIT_UNREADABLE;
  }
  if (pkgDirProbe.kind === "unreadable") {
    console.error(
      `[FAIL] packages directory ${resolvedPackagesDir} is unreadable: ${pkgDirProbe.error}`,
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

  // Per-slug isolation: each slug's audit is wrapped in try/catch so a
  // crash in one slug (e.g. a bug that surfaces a
  // non-Manifest{Malformed,Unreadable}Error the auditPackage catch-all
  // re-wraps with the slug) does not abort the batch. Without isolation
  // a single throw would propagate through `slugs.map` and silently
  // drop every later package, masking drift. Crashes surface as a
  // typed "crashed" PackageIssue on a synthetic PackageReport so they
  // appear in the summary table and per-slug FAIL lines alongside
  // legitimate failures. `hasCrash` drives EXIT_INTERNAL so CI fails
  // loud on an internal bug (distinct from EXIT_MUST_FAILURE so
  // operators can disambiguate "tests tell me a demo is missing" from
  // "the tool itself crashed").
  let hasCrash = false;
  const reports: PackageReport[] = [];
  for (const s of slugs) {
    try {
      reports.push(auditPackage(s, resolvedPackagesDir, resolvedBaseline));
    } catch (err) {
      hasCrash = true;
      // Surface the full cause chain so the per-slug [FAIL] line still
      // carries the underlying message (auditPackage wraps throws with
      // `new Error("audit of <slug> crashed", { cause: err })`).
      const message = formatErrorChain(err);
      reports.push({
        slug: s,
        demoIds: [],
        specFiles: [],
        qaFiles: [],
        demoDirs: [],
        mustErrors: [{ category: "crashed", error: message }],
        warnings: [],
      });
    }
  }

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
    if (r.mustErrors.length > 0) hasMustFailure = true;
    totalWarnings += r.warnings.length;
    // Drive both header and row from HEADER_COLUMNS so widths / alignment
    // can never drift (regression guard — see formatRow).
    console.log(formatRow(r, slugWidth));
  }

  // Emit MUST errors to stderr (failures belong on stderr, not stdout —
  // stdout is reserved for the pass/summary table).
  for (const r of reports) {
    for (const issue of r.mustErrors) {
      console.error(`[FAIL] ${r.slug}: ${deriveMessage(issue)}`);
    }
  }

  // Emit warnings to stderr
  for (const r of reports) {
    for (const w of r.warnings) {
      console.error(`[WARN] ${r.slug}: ${deriveMessage(w)}`);
    }
  }

  console.log(
    `\n${reports.length} package(s) checked, ${reports.filter((r) => r.mustErrors.length === 0).length} pass, ${reports.filter((r) => r.mustErrors.length > 0).length} fail, ${totalWarnings} warning(s)`,
  );

  // Ordering of the exit-code checks is deliberate: a slug crash is an
  // internal defect (EXIT_INTERNAL / 4) and must NOT be downgraded to
  // EXIT_MUST_FAILURE (1) even if other slugs have legitimate MUST
  // failures. Operators seeing exit 4 know the tool itself hit an
  // unexpected code path, distinct from "tests tell me a demo dir is
  // missing".
  //
  // Emit the top-level `[INTERNAL ERROR]` banner in addition to the
  // per-slug `[FAIL] <slug>: audit crashed: ...` lines so operators
  // scanning a large log still see a single unambiguous "tool crashed"
  // signal. The banner is emitted AFTER the summary line so it's the
  // last thing on stderr — matches the behaviour `runParity`'s outer
  // try/catch had before per-slug isolation moved the catch inward.
  if (hasCrash) {
    console.error(
      `[INTERNAL ERROR] validate-parity crashed: one or more packages failed to audit; see per-slug [FAIL] lines above`,
    );
    return EXIT_INTERNAL;
  }
  return hasMustFailure ? EXIT_MUST_FAILURE : EXIT_OK;
}

/**
 * CLI entrypoint. File-internal (NOT exported) because it owns the
 * `process.exitCode` side-effect — callers who want to unit-test or
 * compose the validator should use `runParity` which returns a numeric
 * exit code without touching the process.
 *
 * Setting `process.exitCode` and returning (rather than calling
 * `process.exit(code)`) lets Node drain buffered stdout/stderr before
 * tearing down the process. Synchronous `process.exit` truncates the
 * pass/summary table that `runParity` wrote just above — audit.ts and
 * validate-pins.ts follow the same convention.
 */
function main(packagesDir?: string, baselineDemoCount?: number): void {
  const code = runParity(packagesDir, baselineDemoCount);
  process.exitCode = code;
}

// Only invoke main() when this file is run directly (not when imported by
// tests). Matches the isMain guard pattern used by audit.ts. Call
// path.resolve on BOTH sides to normalise relative segments and ".." /
// "." quirks in argv[1] / import.meta.url — note this does NOT
// canonicalise symlinks (use fs.realpathSync for that); the guard
// tolerates non-canonical-but-equivalent argv shapes, not symlinks
// pointing at the same inode.
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
    // Use `process.exitCode = N` (not `process.exit(N)`) so any buffered
    // stdout/stderr gets a chance to drain — matches audit.ts /
    // validate-pins.ts.
    // Walk the `.cause` chain so wrapped errors (auditPackage throws
    // `new Error("audit of <slug> crashed", { cause })`) render both
    // the outer context and the underlying root cause. Bare
    // `.stack || .message` drops the chain because `Error#stack`
    // doesn't include causes.
    console.error(
      `[INTERNAL ERROR] validate-parity crashed: ${formatErrorChain(err)}`,
    );
    process.exitCode = EXIT_INTERNAL;
  }
}
