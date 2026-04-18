/**
 * Showcase Audit CLI
 *
 * Walks showcase/packages/* and emits a human-readable coverage report
 * comparing declared demos vs. e2e spec files vs. QA markdown, plus
 * deployment status and examples/integrations provenance.
 *
 * Usage:
 *   npx tsx showcase/scripts/audit.ts
 *   npx tsx showcase/scripts/audit.ts --json              # machine-readable output
 *   npx tsx showcase/scripts/audit.ts --slug <slug>       # single package
 *   npx tsx showcase/scripts/audit.ts --json --slug <slug> # single package, JSON
 *
 * Output sections (printed in this order):
 *   1. Per-package summary table (slug | demos | specs | qa | deployed | examples-src)
 *   2. Coverage anomalies (count mismatches, undeployed, missing examples source)
 *   3. Overall health (pass/fail counts + suggestions)
 *
 * Exit codes:
 *   0 — no anomalies found (warnings, if any, are informational by default)
 *   1 — one or more anomalies (deployed=false, count mismatches,
 *       empty packages dir, etc.)
 *   2 — invalid content / user input (bad args, unknown slug)
 *   3 — unreadable (packages dir missing, not-a-directory, or fs failure)
 *   4 — unexpected internal error (uncaught exception)
 *   5 — --strict and warnings present (default run treats warnings
 *       as informational)
 *
 * YAML parsing is delegated to lib/manifest.ts.
 *
 * Testability:
 *   All I/O is parameterised by an `AuditConfig` object so tests can point
 *   at fixture trees. When running as a CLI, the config is derived from
 *   env var `SHOWCASE_AUDIT_ROOT` (for tests) or, by default, the
 *   ancestor `showcase/` directory of this script.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseManifest,
  type Manifest,
  type ParsedManifest,
} from "./lib/manifest.js";
import { BORN_IN_SHOWCASE, SLUG_TO_EXAMPLES } from "./lib/slug-map.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Slug map + born-in-showcase set live in ./lib/slug-map.ts.
// Manifest types + parseManifest live in ./lib/manifest.ts.
// Both are re-exported at the bottom of this file so callers can import
// them from audit.ts.

/**
 * Thrown when the packages dir cannot be read (EACCES, ENOTDIR, etc.).
 * Distinct from generic Error so main()'s top-level catch can map it to
 * EXIT_UNREADABLE (3) rather than EXIT_INTERNAL (4).
 *
 * Uses the ES2022 `Error({ cause })` pattern so callers can still reach
 * the original ErrnoException (with `.code`, `.errno`, `.syscall` etc.)
 * via `err.cause`. Forwarding just `cause.message` would drop those
 * fields.
 */
class UnreadableDirError extends Error {
  constructor(
    public readonly dir: string,
    cause: unknown,
  ) {
    const baseMsg = cause instanceof Error ? cause.message : String(cause);
    const code =
      cause instanceof Error
        ? (cause as NodeJS.ErrnoException).code
        : undefined;
    // Prepend errno code when present and not already embedded in the
    // underlying message (Node's fs errors typically already include it,
    // but custom Errors thrown by stubs/tests may not).
    const msg =
      code && !baseMsg.includes(code) ? `${code}: ${baseMsg}` : baseMsg;
    super(`could not read ${dir}: ${msg}`, { cause });
    this.name = "UnreadableDirError";
  }
}

/**
 * Dependency-injected paths. In CLI mode these are derived from the
 * script's location (or SHOWCASE_AUDIT_ROOT env var for tests). In unit
 * tests, callers pass explicit paths pointing at a fixture tree.
 */
interface AuditConfig {
  packagesDir: string;
  examplesIntegrationsDir: string;
  repoRoot: string;
}

// Exit-code constants — see the module header JSDoc for the full
// contract. We keep them in one place so the internals stay in sync with
// the CLI HELP_TEXT and the module docstring. Declared here (above the
// type definitions) so AuditReport.exitCode can derive its literal union
// from `typeof EXIT_*` rather than hard-coding the numbers, preventing
// drift between the runtime constants and the type.
const EXIT_OK = 0 as const;
const EXIT_ANOMALIES = 1 as const;
const EXIT_INVALID_CONTENT = 2 as const;
const EXIT_UNREADABLE = 3 as const;
const EXIT_INTERNAL = 4 as const;
const EXIT_WARNINGS = 5 as const;

/**
 * Tagged union describing a package-level anomaly. `buildReport`
 * switches on `kind` to classify packages into anomaly buckets.
 *
 * `not-deployed.state` uses a string union (`"unset" | "explicit-false"`)
 * rather than raw `null | false` runtime values — the string encoding
 * is self-documenting at consumption sites (`state === "unset"` vs the
 * easy-to-misread `state === null`) and decouples the anomaly shape from
 * the underlying manifest field encoding. Callers read the boolean
 * directly through `p.manifest.manifest.deployed` when they need the
 * raw value.
 */
type Anomaly =
  | { kind: "missing-manifest" }
  | { kind: "malformed-manifest"; subkind: "syntax" | "shape"; error: string }
  | { kind: "unreadable-manifest"; error: string }
  | { kind: "unreadable-dir"; dir: string; error: string }
  | {
      kind: "count-mismatch";
      dimension: "spec" | "qa";
      expected: number;
      actual: number;
    }
  | { kind: "not-deployed"; state: "unset" | "explicit-false" }
  | { kind: "missing-examples" }
  | {
      kind: "unreadable-examples";
      slug: string;
      candidates: readonly string[];
    };

/**
 * Per-dimension count state. Distinguishes "count=0 because empty" from
 * "count=0 because unreadable" so table rendering and parity checks
 * don't collapse the two into phantom mismatches.
 *
 * This is the sole discriminated union for count outcomes: countFiles
 * returns it directly. Anything storing a count state uses this shape.
 */
type CountState =
  | { state: "ok"; count: number }
  | { state: "missing" } // no count field; countValue() returns 0, countLabel() returns "0"
  | { state: "unreadable"; error: string };

interface PackageAudit {
  slug: string;
  /**
   * Full tagged-union ParsedManifest variant. Keeping the whole
   * variant (not just `.kind`) preserves the correlation between the
   * manifest outcome and the derived fields (`demosDeclared`): downstream
   * consumers that need to, e.g., echo the underlying malformed error or
   * assert on the parsed manifest can reach through `audit.manifest.error`
   * or `audit.manifest.manifest` without needing a second lookup table.
   *
   * Note: the `deployed` boolean is NOT duplicated on PackageAudit —
   * consumers read it via `p.manifest.kind === "ok" ? p.manifest.manifest.deployed : undefined`.
   * Two sources of truth invite drift.
   */
  manifest: ParsedManifest;
  demosDeclared: number;
  spec: CountState;
  qa: CountState;
  examplesSource: string | null; // relative path from repo root, or null
  anomalies: readonly Anomaly[];
  /**
   * Runtime diagnostics that don't rise to the level of an anomaly but
   * callers (JSON consumers, CI dashboards) may want to surface. Each
   * entry is a human-readable string written to stderr as well.
   */
  warnings: readonly string[];
}

/**
 * Literal union of the exit codes `main()` can assign. Derived from the
 * EXIT_* constants so adding a new exit code (or retiring one) only
 * requires changes in one place.
 */
type AuditExitCode =
  | typeof EXIT_OK
  | typeof EXIT_ANOMALIES
  | typeof EXIT_INVALID_CONTENT
  | typeof EXIT_UNREADABLE
  | typeof EXIT_INTERNAL
  | typeof EXIT_WARNINGS;

interface AuditReport {
  /**
   * Top-level scalars for programmatic consumers. `hasAnomalies` mirrors
   * `totals.withAnomalies > 0`; `hasWarnings` mirrors
   * `packages.some(p => p.warnings.length > 0)` so consumers can
   * ratchet on stale-mapping / statSync-race diagnostics without
   * re-walking every package. `exitCode` is the exit code `main()` will
   * actually use (see EXIT_ANOMALIES / EXIT_WARNINGS).
   *
   * These are explicitly derived values — exposed as getters on the live
   * report object so they can't fall out of sync with the underlying
   * packages / anomalies arrays. JSON serialization walks own-enumerable
   * properties by default, so buildReport materializes these to a plain
   * object shape via a per-field Object.defineProperty call that's both
   * enumerable and computed-on-read; see buildReport for the wiring.
   */
  readonly hasAnomalies: boolean;
  readonly hasWarnings: boolean;
  readonly exitCode: AuditExitCode;
  readonly packages: readonly PackageAudit[];
  /**
   * Per-bucket lists. Buckets deliberately overlap: a single package
   * with both a count-mismatch and a not-deployed state appears in
   * BOTH `countMismatches` AND `notDeployed`. `totals.withAnomalies` is
   * the unique-package count (not the sum of bucket lengths).
   *
   * Entries are slug strings (not live PackageAudit references) to
   * prevent downstream consumers from mutating the audit state by
   * accident. Each field is `readonly string[]` so a consumer holding
   * the report reference cannot mutate the audit state.
   */
  readonly anomalies: {
    readonly countMismatches: readonly string[];
    readonly notDeployed: readonly string[];
    readonly missingExamples: readonly string[];
    readonly missingManifest: readonly string[];
    readonly malformedManifest: readonly string[];
    readonly unreadable: readonly string[];
  };
  readonly totals: {
    readonly total: number;
    readonly clean: number;
    readonly withAnomalies: number;
  };
}

// ---------------------------------------------------------------------------
// Config construction
// ---------------------------------------------------------------------------

/**
 * Build an AuditConfig for real CLI execution. Honors `SHOWCASE_AUDIT_ROOT`
 * to allow test subprocesses to point at a fixture tree. When unset,
 * derives paths by walking up from this script's location:
 *   __dirname                   → showcase/scripts/
 *   showcaseRoot = __dirname/.. → showcase/
 *   repoRoot     = showcaseRoot/.. → repo root
 * Each step is a single `..` applied to the previous resolved path.
 *
 * Note: `path.resolve` normalizes path segments (resolving `..` and
 * collapsing `.`) but does NOT canonicalize symlinks. If any segment of
 * the input path is a symlink, the returned path still contains that
 * symlink. Use `fs.realpathSync` to fully canonicalize. For our
 * purposes this is fine — readdir/statSync transparently follow
 * symlinks on access.
 */
function buildCliConfig(): AuditConfig {
  const envRoot = process.env.SHOWCASE_AUDIT_ROOT;
  if (envRoot && envRoot.length > 0) {
    // Tests: SHOWCASE_AUDIT_ROOT=/tmp/fixture → /tmp/fixture/packages,
    // /tmp/fixture/examples/integrations, repoRoot = /tmp/fixture.
    return {
      packagesDir: path.join(envRoot, "packages"),
      examplesIntegrationsDir: path.join(envRoot, "examples", "integrations"),
      repoRoot: envRoot,
    };
  }
  const showcaseRoot = path.resolve(__dirname, "..");
  const repoRoot = path.resolve(showcaseRoot, "..");
  return {
    packagesDir: path.join(showcaseRoot, "packages"),
    examplesIntegrationsDir: path.join(repoRoot, "examples", "integrations"),
    repoRoot,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * List showcase package slugs. Throws UnreadableDirError on fs failures
 * so main() can map them to exit code 3 rather than silently collapsing
 * to "empty packages dir" (exit 1). Missing dir also throws — callers
 * upstream check existence before invoking this.
 */
function listShowcasePackageSlugs(cfg: AuditConfig): string[] {
  try {
    return fs
      .readdirSync(cfg.packagesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch (e) {
    throw new UnreadableDirError(cfg.packagesDir, e);
  }
}

/**
 * Distinguishes four outcomes for a package's manifest.yaml by
 * returning ParsedManifest from lib/manifest.ts directly:
 *   - missing    → file does not exist
 *   - malformed  → file exists but YAML parse or shape validation failed
 *                  (subkind: "syntax" | "shape")
 *   - unreadable → file exists but readFileSync threw (EACCES, I/O race)
 *   - ok         → file parsed and validated successfully
 *
 * Downstream buildReport switches on ALL four variants rather than
 * collapsing `unreadable` into `malformed` with a prefix, so the cause
 * is preserved for structured consumers and CI bucket routing.
 *
 * Delegates to lib/manifest.ts :: parseManifest so audit.ts, validate-pins.ts,
 * and validate-parity.ts all apply identical YAML-shape validation rules.
 */
function readManifest(slug: string, cfg: AuditConfig): ParsedManifest {
  const p = path.join(cfg.packagesDir, slug, "manifest.yaml");
  // Pass slug so parseManifest can enforce the slug-mismatch guard:
  // a manifest whose declared `slug:` disagrees with the directory that
  // holds it is flagged as malformed rather than silently keying a
  // copy-paste/rename mistake into the wrong package downstream.
  return parseManifest(p, slug);
}

/**
 * Count files in a directory matching a predicate. Distinguishes three
 * outcomes so callers can surface genuine errors:
 *   - ok         → read succeeded; count is accurate
 *   - missing    → directory doesn't exist (legitimate zero)
 *   - unreadable → readdir threw (permission, I/O); callers should emit
 *                  an anomaly to avoid silent drops.
 *
 * Returns the public `CountState` shape directly so callers don't have
 * to bridge through an intermediate representation.
 */
function countFiles(
  dir: string,
  extFilter: (name: string) => boolean,
): CountState {
  if (!fs.existsSync(dir)) return { state: "missing" };
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const count = entries.filter((d) => d.isFile() && extFilter(d.name)).length;
    return { state: "ok", count };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Do NOT write to stderr here — the caller (auditPackage) pushes an
    // `unreadable-dir` anomaly which is rendered by renderAnomalySection
    // (single source of truth). Writing here would double-emit.
    return { state: "unreadable", error: msg };
  }
}

/**
 * Numeric view of a CountState for programmatic consumers. Returns
 * `null` for the "unreadable" state so callers cannot mistake an
 * unknowable count for a real zero; "missing" maps to 0 because an
 * absent directory is a legitimate zero. Display callers should prefer
 * `countLabel` which emits "?" for unreadable.
 */
function countValue(s: CountState): number | null {
  switch (s.state) {
    case "ok":
      return s.count;
    case "missing":
      return 0;
    case "unreadable":
      return null;
  }
}

/** Rendered view of a CountState for the summary table. */
function countLabel(s: CountState): string {
  switch (s.state) {
    case "ok":
      return String(s.count);
    case "missing":
      return "0";
    case "unreadable":
      return "?";
  }
}

/**
 * Resolve a showcase slug to its examples/integrations counterpart.
 * Returns null if no candidate exists (which is OK for born-in-showcase
 * packages).
 *
 * statSync is wrapped in try/catch — between existsSync and statSync
 * there's a real (if rare) race window on network filesystems, and we
 * don't want a TOCTOU race to crash the whole audit. Diagnostic strings
 * for statSync failures and stale SLUG_TO_EXAMPLES entries are appended
 * to the caller-supplied `warnings` sink. The caller is responsible for
 * forwarding them to stderr and/or recording them on the PackageAudit —
 * findExamplesSource does NOT touch global state (stdout/stderr).
 *
 * The `warnings` sink is optional — consumers (tests, ad-hoc scripts)
 * that only care about the "found or not found" outcome can omit it,
 * in which case warnings are discarded.
 */
function findExamplesSource(
  slug: string,
  cfg: AuditConfig,
  warnings?: string[],
): string | null {
  return resolveExamplesSource(slug, SLUG_TO_EXAMPLES[slug], cfg, warnings);
}

/**
 * Pure inner of findExamplesSource — the `mapped` argument is injected
 * explicitly so tests can exercise multi-candidate fallback paths
 * without relying on a specific SLUG_TO_EXAMPLES shape. Production
 * callers should use findExamplesSource; tests that need deterministic
 * multi-candidate behavior reach for this helper.
 */
function resolveExamplesSource(
  slug: string,
  mapped: readonly string[] | undefined,
  cfg: AuditConfig,
  warnings?: string[],
): string | null {
  const sink = warnings ?? [];
  const candidates = mapped ?? [slug];
  // Track outcomes per-candidate so we can distinguish "the mapped dirs
  // don't exist" (stale mapping) from "they all exist but we couldn't
  // read ANY of them" (permissions / I/O) — the latter is a CRITICAL
  // warning because we literally cannot tell whether the provenance
  // link is satisfied.
  let unreadableCount = 0;
  let existedCount = 0;
  for (const candidate of candidates) {
    const full = path.join(cfg.examplesIntegrationsDir, candidate);
    if (!fs.existsSync(full)) continue;
    existedCount++;
    try {
      if (fs.statSync(full).isDirectory()) {
        return path.relative(cfg.repoRoot, full);
      }
      // Unmapped slug whose candidate path exists but is a regular file
      // (or other non-dir entry — symlink-to-file, socket, etc.). This
      // is almost always a misconfiguration: the integrations dir has a
      // stray file with the slug's name. Surface it via the sink so
      // operators aren't left wondering why a seemingly present path
      // produced a null provenance. Distinct wording ("exists but is
      // not a directory") from the mapped "no matching directory"
      // warning emitted below. Mapped slugs intentionally don't fan out
      // a per-candidate file warning here — the aggregate "no matching
      // directory" warning already covers the mapping-is-stale case.
      if (!mapped) {
        sink.push(
          `audit: warning: candidate path ${full} exists but is not a directory`,
        );
      }
    } catch (e) {
      // Race condition or permission issue — record on the warnings
      // sink so EACCES / EMFILE / ELOOP don't disappear silently, then
      // continue searching the remaining candidates.
      const msg = e instanceof Error ? e.message : String(e);
      sink.push(`audit: warning: statSync(${full}) failed: ${msg}`);
      unreadableCount++;
      continue;
    }
  }
  // Critical: mapped slug with multiple candidates that ALL exist but
  // ALL failed with fs errors. We can't tell whether the provenance is
  // satisfied — elevate to an ERROR warning so CI / JSON consumers can
  // route this differently from a benign "no matching dir".
  if (mapped && existedCount > 0 && unreadableCount === existedCount) {
    sink.push(
      `audit: ERROR: all candidates unreadable for slug "${slug}" (category: unreadable-candidates) → [${mapped.join(", ")}]`,
    );
    return null;
  }
  // If the slug was *explicitly* mapped but none of its mapped
  // candidates exist, the map is out of sync with the filesystem. Warn
  // (via the sink) rather than error: missing examples counterparts are
  // reported as audit anomalies downstream, not blocking failures.
  // Fallback (unmapped slug → [slug]) is intentionally NOT warned —
  // that's the normal "no mapping needed" path.
  if (mapped) {
    sink.push(
      `audit: warning: SLUG_TO_EXAMPLES entry "${slug}" → [${mapped.join(", ")}] has no matching directory under ${cfg.examplesIntegrationsDir}`,
    );
  }
  return null;
}

function auditPackage(slug: string, cfg: AuditConfig): PackageAudit {
  const manifestRes = readManifest(slug, cfg);
  const pkgDir = path.join(cfg.packagesDir, slug);
  const e2eDir = path.join(pkgDir, "tests", "e2e");
  const qaDir = path.join(pkgDir, "qa");

  const specRes = countFiles(e2eDir, (n) => n.endsWith(".spec.ts"));
  const qaRes = countFiles(qaDir, (n) => n.endsWith(".md"));

  // findExamplesSource records stale SLUG_TO_EXAMPLES / statSync-race
  // warnings on this explicit sink. Callers (main, CI) forward it to
  // stderr; JSON consumers read it off `audit.warnings`.
  const warnings: string[] = [];
  const examplesSource = findExamplesSource(slug, cfg, warnings);

  // Pull demosDeclared directly from the validated manifest
  // (parseManifest guarantees demos is an array of objects and deployed,
  // if present, is a real boolean — so the string "yes"/"no" footgun and
  // the `.length === 4` footgun on a string demos are both ruled out).
  // `deployed` is intentionally NOT duplicated on PackageAudit; consumers
  // read it through `p.manifest.kind === "ok" ? p.manifest.manifest.deployed : undefined`
  // so the manifest variant is the single source of truth.
  const demosDeclared =
    manifestRes.kind === "ok" ? manifestRes.manifest.demos.length : 0;

  // Accumulate anomalies in a local array, then hand the frozen snapshot
  // to the PackageAudit below. Deriving the final shape in one place
  // keeps invariant checks (freeze, read-only array type, no downstream
  // push) local and explicit — rather than mutating the record
  // incrementally as the function walked.
  const anomalies: Anomaly[] = [];

  // Read-error anomalies propagate regardless of manifest state —
  // unreadable dirs are infrastructure failures, not content failures.
  if (specRes.state === "unreadable") {
    anomalies.push({
      kind: "unreadable-dir",
      dir: e2eDir,
      error: specRes.error,
    });
  }
  if (qaRes.state === "unreadable") {
    anomalies.push({
      kind: "unreadable-dir",
      dir: qaDir,
      error: qaRes.error,
    });
  }

  switch (manifestRes.kind) {
    case "missing":
      anomalies.push({ kind: "missing-manifest" });
      break;
    case "malformed":
      anomalies.push({
        kind: "malformed-manifest",
        subkind: manifestRes.subkind,
        error: manifestRes.error,
      });
      break;
    case "unreadable":
      anomalies.push({
        kind: "unreadable-manifest",
        error: manifestRes.error,
      });
      break;
    case "ok": {
      const manifest = manifestRes.manifest;

      // Only report count-parity anomalies when we actually managed to
      // read the directories — otherwise we'd double-report (unreadable
      // + phantom mismatch). When the state is "ok" the count is a real
      // number; "missing" implies count=0 which IS a legitimate data
      // point for parity comparison.
      const specCount = countValue(specRes);
      if (specCount !== null && specCount !== demosDeclared) {
        anomalies.push({
          kind: "count-mismatch",
          dimension: "spec",
          expected: demosDeclared,
          actual: specCount,
        });
      }
      const qaCount = countValue(qaRes);
      if (qaCount !== null && qaCount !== demosDeclared) {
        anomalies.push({
          kind: "count-mismatch",
          dimension: "qa",
          expected: demosDeclared,
          actual: qaCount,
        });
      }

      if (manifest.deployed !== true) {
        anomalies.push({
          kind: "not-deployed",
          // String encoding is self-documenting at consumption sites —
          // callers read the raw boolean off the manifest variant when
          // they need it.
          state: manifest.deployed === false ? "explicit-false" : "unset",
        });
      }

      // Born-in-showcase packages have no Dojo counterpart by design;
      // skip the "missing examples source" check for them.
      if (examplesSource === null && !BORN_IN_SHOWCASE.has(slug)) {
        // Distinguish "mapping is stale / dir simply absent" from the
        // CRITICAL "all mapped candidates exist but none are readable"
        // case that findExamplesSource records on the warnings sink.
        // The latter is an infrastructure failure (permissions / I/O),
        // not a provenance-missing signal — surface it as a separate
        // anomaly variant so downstream consumers can route it
        // differently (CI alerting, suggestions, etc.).
        const unreadableTag = `unreadable-candidates`;
        const unreadableWarningForSlug = warnings.find(
          (w) => w.includes(unreadableTag) && w.includes(`"${slug}"`),
        );
        if (unreadableWarningForSlug) {
          anomalies.push({
            kind: "unreadable-examples",
            slug,
            candidates: Object.freeze(
              (SLUG_TO_EXAMPLES[slug] ?? [slug]).slice(),
            ) as readonly string[],
          });
        } else {
          anomalies.push({ kind: "missing-examples" });
        }
      }
      break;
    }
  }

  // Freeze the mutable containers BEFORE handing them out — direct
  // callers of auditPackage must not be able to push to a "readonly"
  // array that isn't actually frozen at runtime (which would let
  // downstream consumers silently corrupt audit state).
  Object.freeze(anomalies);
  Object.freeze(warnings);

  return {
    slug,
    manifest: manifestRes,
    demosDeclared,
    spec: specRes,
    qa: qaRes,
    examplesSource,
    anomalies,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Anomaly rendering (human-readable strings for the text report)
// ---------------------------------------------------------------------------

function anomalyMessage(a: Anomaly): string {
  switch (a.kind) {
    case "missing-manifest":
      return "missing manifest.yaml";
    case "malformed-manifest":
      return `malformed manifest.yaml (${a.subkind}): ${a.error}`;
    case "unreadable-manifest":
      return `could not read manifest.yaml: ${a.error}`;
    case "unreadable-dir":
      return `could not read ${a.dir}: ${a.error}`;
    case "count-mismatch":
      return `${a.dimension} count (${a.actual}) != demos (${a.expected})`;
    case "not-deployed":
      // Render the string-union state as a familiar label so
      // human-readable output doesn't change. `"explicit-false"` → "false"
      // preserves the historical display; the anomaly itself carries the
      // more explicit string for structured consumers.
      return `deployed=${a.state === "explicit-false" ? "false" : "unset"}`;
    case "missing-examples":
      return "no examples/integrations counterpart";
    case "unreadable-examples":
      return `examples/integrations candidates unreadable for "${a.slug}" → [${a.candidates.join(", ")}]`;
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function padRight(s: string, w: number): string {
  if (s.length >= w) return s;
  return s + " ".repeat(w - s.length);
}
function padLeft(s: string, w: number): string {
  if (s.length >= w) return s;
  return " ".repeat(w - s.length) + s;
}

// Keyed schema for the package summary table. Defining the per-column
// key, label, value projection, and alignment once — instead of relying
// on positional-index coupling between the header array, the row array,
// and the fmtRow alignment callback — eliminates a class of "edit one
// list, forget the other two" bugs (e.g., adding a column that silently
// grows the divider but wraps values under the wrong header).
// Each column carries a stable `key` (machine-readable identifier used
// by `--columns=<csv>` to filter) alongside its display `label`.
// `as const` pins the tuple shape so `ColumnKey` below is a literal
// union of the declared keys — not `string`. parseArgs validates user
// input against that union at runtime, and ParsedArgs.columns carries
// the narrower type.
const TABLE_COLUMNS = [
  {
    key: "slug",
    label: "slug",
    align: "left",
    value: (a: PackageAudit) => a.slug,
  },
  {
    key: "demos",
    label: "demos",
    align: "right",
    value: (a: PackageAudit) => String(a.demosDeclared),
  },
  {
    key: "specs",
    label: "specs",
    align: "right",
    value: (a: PackageAudit) => countLabel(a.spec),
  },
  {
    key: "qa",
    label: "qa",
    align: "right",
    value: (a: PackageAudit) => countLabel(a.qa),
  },
  {
    key: "deployed",
    label: "deployed",
    align: "right",
    value: (a: PackageAudit) => {
      // Read deployed state through the manifest variant — single
      // source of truth. No duplicate `deployed` field on PackageAudit.
      if (a.manifest.kind !== "ok") return "?";
      const d = a.manifest.manifest.deployed;
      if (d === undefined) return "?";
      return d ? "yes" : "no";
    },
  },
  {
    key: "examples-src",
    label: "examples src",
    align: "left",
    value: (a: PackageAudit) => a.examplesSource ?? "—",
  },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  align: "left" | "right";
  value: (a: PackageAudit) => string;
}>;

type ColumnKey = (typeof TABLE_COLUMNS)[number]["key"];

/**
 * Resolve a user-supplied list of column keys to the subset of
 * TABLE_COLUMNS to render, preserving declared column order. Returns
 * `null` (untyped sentinel) if `keys` is undefined — i.e. "use all
 * columns". parseArgs validates keys up-front so this helper can assume
 * every entry is recognised.
 */
function selectColumns(
  keys: readonly ColumnKey[] | null,
): ReadonlyArray<(typeof TABLE_COLUMNS)[number]> {
  if (keys === null) return TABLE_COLUMNS;
  const wanted = new Set<ColumnKey>(keys);
  return TABLE_COLUMNS.filter((c) => wanted.has(c.key));
}

function renderTable(
  audits: readonly PackageAudit[],
  columns: ReadonlyArray<(typeof TABLE_COLUMNS)[number]> = TABLE_COLUMNS,
): string {
  // Empty-list guard: no rows means nothing to align to but the header
  // widths. Without this, `Math.max(h.length, ...[])` still works (the
  // spread of an empty array disappears) but the table would consist of
  // header + divider only, which the caller almost never actually wants.
  // Short-circuit with a dedicated "(no packages)" note instead.
  if (audits.length === 0) {
    return "  (no packages)";
  }

  const rows = audits.map((a) => columns.map((col) => col.value(a)));

  const widths = columns.map((col, i) =>
    Math.max(col.label.length, ...rows.map((r) => r[i].length)),
  );

  const fmtRow = (cells: readonly string[]) =>
    "  " +
    cells
      .map((c, i) =>
        columns[i].align === "left"
          ? padRight(c, widths[i])
          : padLeft(c, widths[i]),
      )
      .join("  ");

  const headerRow = columns.map((col) => col.label);
  const divider = "  " + widths.map((w) => "-".repeat(w)).join("  ");

  return [fmtRow(headerRow), divider, ...rows.map(fmtRow)].join("\n");
}

function renderAnomalySection(report: AuditReport): string {
  const lines: string[] = [];

  const {
    countMismatches,
    notDeployed,
    missingExamples,
    missingManifest,
    malformedManifest,
    unreadable,
  } = report.anomalies;
  const bySlug = new Map(report.packages.map((p) => [p.slug, p]));

  lines.push("Coverage anomalies");
  lines.push("------------------");

  if (missingManifest.length > 0) {
    lines.push("");
    lines.push("  Missing manifest.yaml:");
    for (const slug of missingManifest) lines.push(`    - ${slug}`);
  }

  if (malformedManifest.length > 0) {
    lines.push("");
    lines.push("  Malformed manifest.yaml:");
    for (const slug of malformedManifest) {
      const p = bySlug.get(slug);
      const reason =
        p?.anomalies.find((a) => a.kind === "malformed-manifest") ?? null;
      const msg = reason ? anomalyMessage(reason) : "malformed manifest.yaml";
      lines.push(`    - ${slug}: ${msg}`);
    }
  }

  if (unreadable.length > 0) {
    lines.push("");
    lines.push("  Unreadable directories:");
    for (const slug of unreadable) {
      const p = bySlug.get(slug);
      // Prefer the first I/O-category anomaly on the package — any of
      // unreadable-dir / unreadable-manifest / unreadable-examples may
      // be present; render whichever we find first.
      const reason =
        p?.anomalies.find(
          (a) =>
            a.kind === "unreadable-dir" ||
            a.kind === "unreadable-manifest" ||
            a.kind === "unreadable-examples",
        ) ?? null;
      const msg = reason ? anomalyMessage(reason) : "could not read";
      lines.push(`    - ${slug}: ${msg}`);
    }
  }

  if (countMismatches.length > 0) {
    lines.push("");
    lines.push("  Count mismatches (specs or qa differ from demos):");
    for (const slug of countMismatches) {
      const p = bySlug.get(slug);
      if (!p) continue;
      lines.push(
        `    - ${slug}: demos=${p.demosDeclared} specs=${countLabel(p.spec)} qa=${countLabel(p.qa)}`,
      );
    }
  }

  if (notDeployed.length > 0) {
    lines.push("");
    lines.push("  Not deployed (deployed != true):");
    for (const slug of notDeployed) {
      const p = bySlug.get(slug);
      const deployed =
        p?.manifest.kind === "ok" ? p.manifest.manifest.deployed : undefined;
      // Human-readable label: the historical "false" / "unset" strings —
      // not the internal Anomaly.state encoding.
      const state = deployed === false ? "false" : "unset";
      lines.push(`    - ${slug} (${state})`);
    }
  }

  if (missingExamples.length > 0) {
    lines.push("");
    lines.push("  No examples/integrations counterpart:");
    for (const slug of missingExamples) {
      lines.push(`    - ${slug}`);
    }
  }

  if (
    missingManifest.length === 0 &&
    malformedManifest.length === 0 &&
    unreadable.length === 0 &&
    countMismatches.length === 0 &&
    notDeployed.length === 0 &&
    missingExamples.length === 0
  ) {
    lines.push("");
    lines.push("  (none)");
  }

  return lines.join("\n");
}

function renderHealthSection(report: AuditReport): string {
  const { total, clean, withAnomalies } = report.totals;
  const lines: string[] = [];
  lines.push("Overall health");
  lines.push("--------------");
  lines.push(`  Packages total:   ${total}`);
  lines.push(`  Clean:            ${clean}`);
  lines.push(`  With anomalies:   ${withAnomalies}`);
  lines.push("");

  if (withAnomalies === 0) {
    lines.push("  All packages pass coverage audit.");
    return lines.join("\n");
  }

  const suggestions: string[] = [];
  if (report.anomalies.countMismatches.length > 0) {
    suggestions.push(
      "Align demos/specs/qa counts — each declared demo should have exactly one spec and one QA doc.",
    );
  }
  if (report.anomalies.notDeployed.length > 0) {
    suggestions.push(
      "Mark packages as `deployed: true` once their Railway service is live.",
    );
  }
  if (report.anomalies.missingExamples.length > 0) {
    suggestions.push(
      "Add the slug to SLUG_TO_EXAMPLES in showcase/scripts/lib/slug-map.ts, or add it to BORN_IN_SHOWCASE if the package has no Dojo counterpart.",
    );
  }
  if (report.anomalies.missingManifest.length > 0) {
    suggestions.push(
      "Create a manifest.yaml for each package directory or remove the directory.",
    );
  }
  if (report.anomalies.malformedManifest.length > 0) {
    suggestions.push(
      "Fix YAML syntax in malformed manifest.yaml files — see anomaly details above.",
    );
  }
  if (report.anomalies.unreadable.length > 0) {
    suggestions.push(
      "Unreadable directories usually indicate a permission or filesystem issue — check the error detail above.",
    );
  }

  lines.push("  Suggestions:");
  for (const s of suggestions) lines.push(`    - ${s}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Pure exit-code calculation. Extracted so it can be unit-tested
 * independently of the auditPackage code path (which is otherwise
 * tricky to drive into the "warnings without anomalies" quadrant using
 * filesystem fixtures alone).
 *
 * Return type is narrowed to the three literal values this function
 * can actually produce (0, 1, or 5). The wider AuditExitCode union
 * covers values main() assigns on other control-flow paths (2, 3, 4)
 * that do not go through this helper.
 *
 * Contract:
 *   - anomalies present → EXIT_ANOMALIES (1), regardless of strict/warnings
 *   - no anomalies, --strict, warnings present → EXIT_WARNINGS (5)
 *   - no anomalies, default OR strict-without-warnings → EXIT_OK (0)
 */
function computeExitCode(input: {
  hasAnomalies: boolean;
  hasWarnings: boolean;
  strict: boolean;
}): typeof EXIT_OK | typeof EXIT_ANOMALIES | typeof EXIT_WARNINGS {
  if (input.hasAnomalies) return EXIT_ANOMALIES;
  if (input.strict && input.hasWarnings) return EXIT_WARNINGS;
  return EXIT_OK;
}

function buildReport(
  slugs: string[],
  cfg: AuditConfig,
  opts: { strict?: boolean } = {},
): AuditReport {
  const packages = slugs.map((s) => auditPackage(s, cfg));

  // Classify via tagged-union `Anomaly.kind` for stable, typo-proof
  // bucket routing.
  //
  // Invariant: auditPackage only emits a count-mismatch anomaly when
  // the underlying count is readable (see `specCount !== null` /
  // `qaCount !== null` guards in auditPackage). The presence of a
  // `count-mismatch` anomaly in `p.anomalies` already implies the
  // relevant dimension was readable, so no secondary suppression is
  // needed here.
  const countMismatches = packages
    .filter((p) => p.manifest.kind === "ok")
    .filter((p) => p.anomalies.some((a) => a.kind === "count-mismatch"))
    .map((p) => p.slug);
  // `deployed` is read through the manifest variant — the single
  // source of truth. A package with no manifest or a malformed one is
  // surfaced via its own anomaly and does not double-count here.
  const notDeployed = packages
    .filter(
      (p) => p.manifest.kind === "ok" && p.manifest.manifest.deployed !== true,
    )
    .map((p) => p.slug);
  const missingExamples = packages
    .filter(
      (p) =>
        p.manifest.kind === "ok" &&
        p.examplesSource === null &&
        !BORN_IN_SHOWCASE.has(p.slug),
    )
    .map((p) => p.slug);
  const missingManifest = packages
    .filter((p) => p.manifest.kind === "missing")
    .map((p) => p.slug);
  // `malformedManifest` groups content-shape problems. `unreadable-manifest`
  // is a distinct I/O condition classified under `unreadable` alongside
  // spec/qa-dir read failures (infrastructure, not content).
  const malformedManifest = packages
    .filter((p) => p.manifest.kind === "malformed")
    .map((p) => p.slug);
  const unreadable = packages
    .filter((p) =>
      p.anomalies.some(
        (a) =>
          a.kind === "unreadable-dir" ||
          a.kind === "unreadable-manifest" ||
          a.kind === "unreadable-examples",
      ),
    )
    .map((p) => p.slug);

  const withAnomalies = packages.filter((p) => p.anomalies.length > 0).length;

  // Deep-freeze audit records so downstream consumers can't accidentally
  // mutate them. anomalies/warnings were already frozen by auditPackage
  // (so direct callers see an immutable view); buildReport additionally
  // freezes the record and its remaining inner containers.
  for (const p of packages) {
    Object.freeze(p.spec);
    Object.freeze(p.qa);
    Object.freeze(p.manifest);
    // The "ok" variant carries a nested Manifest object. Freeze the
    // manifest AND its demos array (plus each demo entry) so callers
    // holding a reference cannot rewrite `deployed` OR rearrange the
    // demos list on a shared object. yaml.parse returns plain mutable
    // arrays/objects, so we need to freeze them ourselves.
    if (p.manifest.kind === "ok") {
      const m = p.manifest.manifest;
      if (m.demos) {
        for (const d of m.demos) Object.freeze(d);
        Object.freeze(m.demos);
      }
      Object.freeze(m);
    }
    Object.freeze(p);
  }

  const strict = opts.strict ?? false;

  // hasAnomalies / hasWarnings / exitCode are derived from `packages`
  // and `withAnomalies` — NOT cached snapshots. Defined as class
  // getters so (a) the shape structurally matches AuditReport without
  // any `as unknown as` cast and (b) there is only ONE source of truth
  // for each scalar (the getter computation itself), not a parallel
  // cached copy.
  //
  // JSON serialization: class getters are non-enumerable by default, so
  // we opt them into JSON output via a toJSON() method that produces a
  // plain object carrying the derived scalars alongside the data
  // buckets. This preserves the external JSON contract (consumers see
  // `hasAnomalies`, `hasWarnings`, `exitCode` as top-level fields).
  const anomaliesBucket = Object.freeze({
    countMismatches: Object.freeze(countMismatches) as readonly string[],
    notDeployed: Object.freeze(notDeployed) as readonly string[],
    missingExamples: Object.freeze(missingExamples) as readonly string[],
    missingManifest: Object.freeze(missingManifest) as readonly string[],
    malformedManifest: Object.freeze(malformedManifest) as readonly string[],
    unreadable: Object.freeze(unreadable) as readonly string[],
  });
  const totals = Object.freeze({
    total: packages.length,
    clean: packages.length - withAnomalies,
    withAnomalies,
  });

  class AuditReportImpl implements AuditReport {
    readonly packages: readonly PackageAudit[];
    readonly anomalies: AuditReport["anomalies"];
    readonly totals: AuditReport["totals"];
    constructor(
      pkgs: readonly PackageAudit[],
      a: AuditReport["anomalies"],
      t: AuditReport["totals"],
    ) {
      this.packages = pkgs;
      this.anomalies = a;
      this.totals = t;
    }
    get hasAnomalies(): boolean {
      return this.totals.withAnomalies > 0;
    }
    get hasWarnings(): boolean {
      return this.packages.some((p) => p.warnings.length > 0);
    }
    get exitCode(): AuditExitCode {
      return computeExitCode({
        hasAnomalies: this.hasAnomalies,
        hasWarnings: this.hasWarnings,
        strict,
      });
    }
    toJSON(): {
      hasAnomalies: boolean;
      hasWarnings: boolean;
      exitCode: AuditExitCode;
      packages: readonly PackageAudit[];
      anomalies: AuditReport["anomalies"];
      totals: AuditReport["totals"];
    } {
      return {
        hasAnomalies: this.hasAnomalies,
        hasWarnings: this.hasWarnings,
        exitCode: this.exitCode,
        packages: this.packages,
        anomalies: this.anomalies,
        totals: this.totals,
      };
    }
  }
  const report = new AuditReportImpl(packages, anomaliesBucket, totals);
  return Object.freeze(report);
}

interface ParsedArgs {
  json: boolean;
  slug: string | null;
  strict: boolean;
  /**
   * Subset of column keys (see TABLE_COLUMNS) to render, in declared
   * order. `null` means "render all columns" — distinct from `[]`
   * (which would render NOTHING). parseArgs validates every supplied
   * key against TABLE_COLUMNS up-front.
   */
  columns: readonly ColumnKey[] | null;
  help: boolean;
  /**
   * readonly so a caller walking the struct cannot silently push new
   * errors to it. Mutation stays internal to parseArgs.
   */
  errors: readonly string[];
}

// Flag-aware argv parser. Rejects `--slug --json` rather than silently
// consuming `--json` as the slug value. Rejects duplicate `--slug` or
// `--json` (e.g. `--json --json` or `--slug a --slug b`) rather than
// last-wins, since CI shell concatenation is a common source of
// accidental duplicates and "last wins" hides the user's first intent.
// Returns parse errors so the caller can distinguish invalid arguments
// (exit 2) from package anomalies (exit 1).
function parseArgs(argv: string[]): ParsedArgs {
  let json = false;
  let slug: string | null = null;
  let help = false;
  let strict = false;
  let columns: ColumnKey[] | null = null;
  const errors: string[] = [];
  // Track which flags have already been set so duplicates surface as
  // explicit errors instead of being silently overwritten.
  let sawJson = false;
  let sawSlug = false;
  let sawStrict = false;
  let sawColumns = false;

  const validColumnKeys = new Set<ColumnKey>(TABLE_COLUMNS.map((c) => c.key));

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") {
      if (sawJson) {
        errors.push("--json specified more than once");
      }
      sawJson = true;
      json = true;
    } else if (a === "--strict") {
      if (sawStrict) {
        errors.push("--strict specified more than once");
      }
      sawStrict = true;
      strict = true;
    } else if (a === "--slug") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        errors.push(
          `--slug requires a value (not a flag like "${next ?? "(end of argv)"}")`,
        );
      } else {
        if (sawSlug) {
          errors.push(
            `--slug specified more than once (first="${slug}", second="${next}")`,
          );
        }
        sawSlug = true;
        slug = next;
        i++;
      }
    } else if (a.startsWith("--columns=")) {
      if (sawColumns) {
        errors.push("--columns specified more than once");
      }
      sawColumns = true;
      const raw = a.slice("--columns=".length);
      const parts = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (parts.length === 0) {
        errors.push("--columns requires at least one key");
      } else {
        const unknown = parts.filter(
          (k): k is string => !(validColumnKeys as Set<string>).has(k),
        );
        if (unknown.length > 0) {
          errors.push(
            `--columns: unknown column key(s): ${unknown.join(", ")} (valid keys: ${[...validColumnKeys].join(", ")})`,
          );
        } else {
          // Narrowed: every `parts` entry passed the validColumnKeys
          // membership check, so the cast is sound (runtime-verified).
          columns = parts as ColumnKey[];
        }
      }
    } else if (a === "--help" || a === "-h") {
      help = true;
    } else {
      errors.push(`unrecognised argument: ${a}`);
    }
  }
  return { json, slug, strict, columns, help, errors };
}

const HELP_TEXT = [
  "Usage: npx tsx showcase/scripts/audit.ts [options]",
  "",
  "Options:",
  "  --json              Emit machine-readable JSON instead of a table",
  "  --slug <slug>       Audit only the given showcase package slug",
  "  --strict            Exit 5 if any warnings are present (default: warnings",
  "                      are informational and do not affect exit code)",
  "  --columns=<csv>     Render only the listed columns (comma-separated keys;",
  "                      declared order preserved). Valid keys: slug, demos,",
  "                      specs, qa, deployed, examples-src",
  "  -h, --help          Show this help",
  "",
  "Examples:",
  "  npx tsx showcase/scripts/audit.ts",
  "  npx tsx showcase/scripts/audit.ts --json",
  "  npx tsx showcase/scripts/audit.ts --slug mastra",
  "  npx tsx showcase/scripts/audit.ts --json --slug mastra",
  "  npx tsx showcase/scripts/audit.ts --strict",
  "  npx tsx showcase/scripts/audit.ts --columns=slug,demos,deployed",
  "",
  "Output order: summary table → coverage anomalies → overall health.",
  "",
  "Exit codes:",
  "  0 — no anomalies (warnings, if any, are informational by default)",
  "  1 — anomalies found (see anomaly section, or empty packages dir)",
  "  2 — invalid content / user input (bad args, unknown slug)",
  "  3 — unreadable (packages path missing, not a directory, or fs failure)",
  "  4 — unexpected internal error",
  "  5 — warnings present with --strict (default: warnings don't change exit)",
].join("\n");

// Heuristic: treat TypeError / ReferenceError / RangeError as programmer
// bugs (broken invariant, likely worth a bug report), not as
// infrastructure failures. A Node ErrnoException (any Error carrying a
// `.code` string like "EACCES" / "ENOENT") is always a runtime I/O
// condition even if the instance resolves to TypeError via weird
// subclass drift — we bias the other way and treat `.code`-bearing
// errors as runtime, not programmer. Everything else that reaches the
// top-level catch is more likely an unhandled I/O or runtime condition.
// Both still land on EXIT_INTERNAL, but the diagnostic wording differs
// so the on-call reader can triage faster.
function isProgrammerBug(e: unknown): boolean {
  // Errno-carrying errors (EACCES / ENOENT / EIO / ELOOP / etc.) are
  // runtime conditions, not programmer bugs. The shape match is
  // intentionally loose: we accept any Error instance that carries a
  // string `.code`.
  if (
    e instanceof Error &&
    typeof (e as NodeJS.ErrnoException).code === "string"
  ) {
    return false;
  }
  return (
    e instanceof TypeError ||
    e instanceof ReferenceError ||
    e instanceof RangeError
  );
}

// All exit paths use `process.exitCode = N; return;` instead of
// `process.exit(N)` so that stdout has time to drain before the process
// terminates — `process.exit` is synchronous and can truncate
// buffered JSON output on fast exits (observed in CI logs under heavy
// load). The `return` statements terminate main(); the event loop
// drains and the process exits with the set code.
function main(): void {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) {
      console.log(HELP_TEXT);
      process.exitCode = 0;
      return;
    }
    if (parsed.errors.length > 0) {
      for (const err of parsed.errors) {
        console.error(`audit: ${err}`);
      }
      console.error("");
      console.error(HELP_TEXT);
      process.exitCode = EXIT_INVALID_CONTENT;
      return;
    }

    const cfg = buildCliConfig();

    if (!fs.existsSync(cfg.packagesDir)) {
      console.error(`audit: packages dir does not exist: ${cfg.packagesDir}`);
      process.exitCode = EXIT_UNREADABLE;
      return;
    }
    // stat the packages path to distinguish "exists as a file" from
    // "exists as a dir". Without this explicit check, readdirSync's
    // ENOTDIR would be caught and collapsed into "empty packages" (exit
    // 1), masking the real cause — map it to EXIT_UNREADABLE instead.
    try {
      if (!fs.statSync(cfg.packagesDir).isDirectory()) {
        console.error(
          `audit: packages path is not a directory: ${cfg.packagesDir}`,
        );
        process.exitCode = EXIT_UNREADABLE;
        return;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`audit: could not stat ${cfg.packagesDir}: ${msg}`);
      process.exitCode = EXIT_UNREADABLE;
      return;
    }

    const allSlugs = listShowcasePackageSlugs(cfg);

    if (parsed.slug && !allSlugs.includes(parsed.slug)) {
      console.error(`audit: unknown showcase package slug: ${parsed.slug}`);
      console.error(
        `audit: available slugs: ${allSlugs.join(", ") || "(none)"}`,
      );
      process.exitCode = EXIT_INVALID_CONTENT;
      return;
    }

    const slugs = parsed.slug ? [parsed.slug] : allSlugs;

    if (slugs.length === 0) {
      console.error(
        `audit: packages dir is empty: ${cfg.packagesDir} — nothing to audit`,
      );
      // Empty packages dir is a genuine anomaly (working-as-designed audit
      // should have something to audit), so exit 1 not 2.
      process.exitCode = EXIT_ANOMALIES;
      return;
    }

    const report = buildReport(slugs, cfg, { strict: parsed.strict });

    if (parsed.json) {
      // In JSON mode, stdout carries the full report and the
      // `packages[].warnings` array carries any per-package diagnostics.
      // We deliberately suppress the stderr mirror of those warnings to
      // avoid double-emitting the same information — JSON consumers read
      // the structured field, and a redirected `2>/dev/null` JSON run
      // stays machine-parseable.
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      // In text mode, forward each PackageAudit's warnings to stderr so a
      // human reader watching the terminal still sees the stale
      // SLUG_TO_EXAMPLES / statSync-race diagnostics that findExamplesSource
      // recorded. JSON mode (above) has these on the structured record.
      for (const p of report.packages) {
        for (const w of p.warnings) {
          process.stderr.write(w + "\n");
        }
      }
      console.log("Per-package summary");
      console.log("-------------------");
      console.log(renderTable(report.packages, selectColumns(parsed.columns)));
      console.log("");
      console.log(renderAnomalySection(report));
      console.log("");
      console.log(renderHealthSection(report));
    }

    process.exitCode = report.exitCode;
    return;
  } catch (e) {
    // UnreadableDirError is a known I/O condition, not a bug — map to
    // EXIT_UNREADABLE (3) so CI can distinguish "permission denied on
    // packages dir" from "undefined is not a function".
    if (e instanceof UnreadableDirError) {
      console.error(`audit: ${e.message}`);
      process.exitCode = EXIT_UNREADABLE;
      return;
    }
    // Programmer bugs (TypeError / ReferenceError / RangeError) and
    // unhandled I/O/runtime errors both exit 4 but carry distinct
    // diagnostic prefixes so the on-call reader can tell "fix the code"
    // from "investigate the environment" at a glance.
    const stack = e instanceof Error ? e.stack || e.message : String(e);
    if (isProgrammerBug(e)) {
      console.error(`audit: bug (programmer error): ${stack}`);
    } else {
      console.error(`audit: internal error: ${stack}`);
    }
    process.exitCode = EXIT_INTERNAL;
    return;
  }
}

/**
 * Canonicalize a path for "is this the script being run?" comparison.
 * Uses `fs.realpathSync` so a symlink to audit.ts (e.g. a globally
 * linked CLI, or a node_modules symlink hop under pnpm) on either side
 * of the comparison still matches the canonical source path. Falls back
 * to the `path.resolve`-d path when `realpathSync` fails.
 *
 * Failure modes:
 * - ENOENT: silent fallback (legitimate — some test harnesses hand a
 *   synthetic argv[0] that doesn't exist on disk).
 * - Non-ENOENT errno errors (e.g. EACCES, ELOOP): emit a stderr
 *   diagnostic and terminate the process with EXIT_UNREADABLE via
 *   `process.exit`. We cannot use `process.exitCode` here because this
 *   helper runs BEFORE main() during the `isMain` guard; main() later
 *   overwrites `process.exitCode` with `report.exitCode`, which would
 *   clobber the EXIT_UNREADABLE signal. `process.exit` ensures CI still
 *   sees a distinct signal (exit 3) separable from drift (exit 1).
 */
function canonicalizeForIsMain(p: string): string {
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync(resolved);
  } catch (e) {
    const code =
      e instanceof Error ? (e as NodeJS.ErrnoException).code : undefined;
    if (code !== "ENOENT") {
      process.stderr.write(
        `[canonicalizeForIsMain] realpath failed for ${resolved}: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      // Elevate to EXIT_UNREADABLE so CI can distinguish a genuine
      // filesystem-access failure (EACCES/ELOOP/EIO) from benign
      // ENOENT fallback (synthetic argv[0]) and from drift (exit 1).
      // `process.exit` (not `process.exitCode`) so the signal survives
      // main()'s subsequent `process.exitCode = report.exitCode` write
      // — this helper runs pre-main during the `isMain` guard.
      process.exit(EXIT_UNREADABLE);
    }
    return resolved;
  }
}

// Only run when executed directly. Canonicalizes both sides via
// realpathSync to match across symlinks (tsx shim, pnpm hoisting,
// globally linked CLI, etc.).
if (
  process.argv[1] &&
  canonicalizeForIsMain(process.argv[1]) ===
    canonicalizeForIsMain(fileURLToPath(import.meta.url))
) {
  main();
}

export {
  auditPackage,
  buildReport,
  computeExitCode,
  listShowcasePackageSlugs,
  readManifest,
  countFiles,
  findExamplesSource,
  resolveExamplesSource,
  isProgrammerBug,
  parseArgs,
  anomalyMessage,
  UnreadableDirError,
  canonicalizeForIsMain,
  BORN_IN_SHOWCASE,
  SLUG_TO_EXAMPLES,
};
export type {
  AuditReport,
  PackageAudit,
  AuditConfig,
  Anomaly,
  CountState,
  Manifest,
  ParsedManifest,
};
