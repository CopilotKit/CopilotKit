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
 *   1. Per-package summary table (slug | demos | specs | qa | deployed | examples src)
 *   2. Coverage anomalies (count mismatches, undeployed, missing examples source)
 *   3. Overall health (pass/fail counts + suggestions)
 *
 * Exit codes:
 *   0 — no anomalies found
 *   1 — one or more anomalies (deployed=false, count mismatches,
 *       empty packages dir, etc.)
 *   2 — invalid content / user input (bad args, unknown slug)
 *   3 — unreadable (packages dir missing, not-a-directory, or fs failure)
 *   4 — unexpected internal error (uncaught exception)
 *
 * No new npm deps. Reuses `yaml` which is already declared in
 * showcase/scripts/package.json. Self-sufficient: does not depend on any
 * sibling validator scripts that may or may not exist.
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
// Both are re-exported at the bottom of this file for backwards
// compatibility with existing tests that import them from audit.ts.

/**
 * Thrown when the packages dir cannot be read (EACCES, ENOTDIR, etc.).
 * Distinct from generic Error so main()'s top-level catch can map it to
 * EXIT_UNREADABLE (3) rather than EXIT_INTERNAL (4).
 *
 * Uses the ES2022 `Error({ cause })` pattern so callers can still reach
 * the original ErrnoException (with `.code`, `.errno`, `.syscall` etc.)
 * via `err.cause`. Previously we only forwarded `cause.message`, which
 * dropped those fields silently.
 */
class UnreadableDirError extends Error {
  constructor(
    public readonly dir: string,
    cause: unknown,
  ) {
    const msg = cause instanceof Error ? cause.message : String(cause);
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

/**
 * Tagged union describing a package-level anomaly. Replaces the earlier
 * `anomalies: string[]` kitchen sink — downstream `buildReport` used to
 * classify via `startsWith("could not read")` / `startsWith("malformed")`,
 * which was brittle and invited typos to silently mis-bucket packages.
 * Now `buildReport` switches on `kind`.
 */
type Anomaly =
  | { kind: "missing-manifest" }
  | { kind: "malformed-manifest"; error: string }
  | { kind: "unreadable-dir"; dir: string; error: string }
  | {
      kind: "count-mismatch";
      dimension: "spec" | "qa";
      expected: number;
      actual: number;
    }
  | { kind: "not-deployed"; state: "false" | "unset" }
  | { kind: "missing-examples" };

/**
 * Per-dimension count state. Introduced to distinguish "count=0 because
 * empty" from "count=0 because unreadable", which the old flat-number
 * representation collapsed — leading to misleading tables and phantom
 * parity mismatches.
 */
type CountState =
  | { state: "ok"; count: number }
  | { state: "missing" } // count is implicitly 0
  | { state: "unreadable"; error: string };

interface PackageAudit {
  slug: string;
  /**
   * Full tagged-union variant from readManifest. Keeping the whole
   * variant (not just `.kind`) preserves the correlation between the
   * manifest outcome and the derived fields (`demosDeclared`,
   * `deployed`): downstream consumers that need to, e.g., echo the
   * underlying malformed error or assert on the parsed manifest can
   * reach through `audit.manifest.error` or `audit.manifest.manifest`
   * without needing a second lookup table.
   */
  manifest: ManifestResult;
  demosDeclared: number;
  spec: CountState;
  qa: CountState;
  deployed: boolean | null;
  examplesSource: string | null; // relative path from repo root, or null
  anomalies: readonly Anomaly[];
  /**
   * Runtime diagnostics that don't rise to the level of an anomaly but
   * callers (JSON consumers, CI dashboards) may want to surface. Each
   * entry is a human-readable string written to stderr as well.
   */
  warnings: readonly string[];
}

interface AuditReport {
  /**
   * Top-level scalars for programmatic consumers. `hasAnomalies` mirrors
   * `totals.withAnomalies > 0`; `exitCode` is the exit code `main()` will
   * actually use.
   */
  hasAnomalies: boolean;
  exitCode: number;
  packages: PackageAudit[];
  /**
   * Per-bucket lists. Buckets deliberately overlap: a single package
   * with both a count-mismatch and a not-deployed state appears in
   * BOTH `countMismatches` AND `notDeployed`. `totals.withAnomalies` is
   * the unique-package count (not the sum of bucket lengths).
   *
   * Entries are slug strings (not live PackageAudit references) to
   * prevent downstream consumers from mutating the audit state by
   * accident.
   */
  anomalies: {
    countMismatches: string[];
    notDeployed: string[];
    missingExamples: string[];
    missingManifest: string[];
    malformedManifest: string[];
    unreadable: string[];
  };
  totals: {
    total: number;
    clean: number;
    withAnomalies: number;
  };
}

// Alias kept for call-site stability. The shared ParsedManifest adds an
// "unreadable" variant that audit.ts collapses into "malformed" with a
// prefixed error (see readManifest below) — this preserves the three-
// state semantics that downstream code and existing tests rely on.
type ManifestResult =
  | { kind: "ok"; manifest: Manifest }
  | { kind: "missing" }
  | { kind: "malformed"; error: string };

type CountResult =
  | { kind: "ok"; count: number }
  | { kind: "missing"; count: 0 }
  | { kind: "error"; count: 0; error: string };

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
 * (Each step is a single `..` applied to the previous resolved path —
 * not `../..` applied to __dirname, which is what the older comment
 * read as.)
 *
 * Note: `path.resolve` normalizes but does NOT follow symlinks. If the
 * repo is accessed through a symlink, the computed paths will reflect
 * the symlink path rather than the canonical one — which is fine for
 * our purposes (readdir/statSync happily follow symlinks too).
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
  const showcaseRoot = path.resolve(__dirname, ".."); // showcase/scripts → showcase
  const repoRoot = path.resolve(showcaseRoot, ".."); // showcase → repo root
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
 * Distinguishes three outcomes for a package's manifest.yaml:
 *   - missing   → file does not exist
 *   - malformed → file exists but YAML parse failed OR the shared
 *                 parseManifest reported "unreadable" (EACCES, I/O
 *                 race, etc.) — we prefix "read failed: " in that case
 *                 so the downstream anomaly reader distinguishes the
 *                 cause without needing another union variant
 *   - ok        → file parsed successfully
 *
 * The previous implementation collapsed malformed into missing with an
 * empty catch{}, which silently reported "missing manifest.yaml" for
 * broken YAML and made debugging misleading.
 *
 * Delegates to lib/manifest.ts :: parseManifest so audit.ts, validate-pins.ts,
 * and validate-parity.ts all apply identical YAML-shape validation rules.
 */
function readManifest(slug: string, cfg: AuditConfig): ManifestResult {
  const p = path.join(cfg.packagesDir, slug, "manifest.yaml");
  const parsed: ParsedManifest = parseManifest(p);
  switch (parsed.kind) {
    case "ok":
    case "missing":
    case "malformed":
      return parsed;
    case "unreadable":
      // Collapse unreadable into malformed with a distinguishing prefix.
      // Keeps the pre-existing ManifestResult shape that audit.ts /
      // buildReport() / the tests already depend on.
      return { kind: "malformed", error: `read failed: ${parsed.error}` };
  }
}

/**
 * Count files in a directory matching a predicate. Distinguishes three
 * outcomes so callers can surface genuine errors:
 *   - missing → directory doesn't exist (legitimate zero)
 *   - ok      → read succeeded; count is accurate
 *   - error   → readdir threw (permission, I/O); count defaults to 0 but
 *               callers should emit an anomaly to avoid silent drops.
 *
 * The previous implementation swallowed errors and returned 0, which
 * could trigger phantom parity anomalies for packages whose spec dirs
 * were simply unreadable.
 */
function countFiles(
  dir: string,
  extFilter: (name: string) => boolean,
): CountResult {
  if (!fs.existsSync(dir)) return { kind: "missing", count: 0 };
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const count = entries.filter((d) => d.isFile() && extFilter(d.name)).length;
    return { kind: "ok", count };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`audit: could not read ${dir}: ${msg}\n`);
    return { kind: "error", count: 0, error: msg };
  }
}

function toCountState(r: CountResult): CountState {
  switch (r.kind) {
    case "ok":
      return { state: "ok", count: r.count };
    case "missing":
      return { state: "missing" };
    case "error":
      return { state: "unreadable", error: r.error };
  }
}

/** Numeric view of a CountState for the summary table. */
function countValue(s: CountState): number {
  return s.state === "ok" ? s.count : 0;
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
 * A narrow overload keeps the legacy no-sink call shape for external
 * consumers (tests, ad-hoc scripts) that only care about the boolean
 * "found or not found" outcome: in that case warnings are discarded.
 */
function findExamplesSource(
  slug: string,
  cfg: AuditConfig,
  warnings?: string[],
): string | null {
  const sink = warnings ?? [];
  const mapped = SLUG_TO_EXAMPLES[slug];
  const candidates = mapped ?? [slug];
  for (const candidate of candidates) {
    const full = path.join(cfg.examplesIntegrationsDir, candidate);
    if (!fs.existsSync(full)) continue;
    try {
      if (fs.statSync(full).isDirectory()) {
        return path.relative(cfg.repoRoot, full);
      }
    } catch (e) {
      // Race condition or permission issue — record on the warnings
      // sink so EACCES / EMFILE / ELOOP don't disappear silently, then
      // continue searching the remaining candidates.
      const msg = e instanceof Error ? e.message : String(e);
      sink.push(`audit: warning: statSync(${full}) failed: ${msg}`);
      continue;
    }
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
  // warnings on this explicit sink — no more global stderr monkey-patch.
  // Callers (main, CI) forward it to stderr; JSON consumers read it off
  // `audit.warnings`.
  const warnings: string[] = [];
  const examplesSource = findExamplesSource(slug, cfg, warnings);

  // Pull demosDeclared + deployed directly from the validated manifest
  // (parseManifest guarantees demos is an array of objects and deployed,
  // if present, is a real boolean — so the string "yes"/"no" footgun and
  // the `.length === 4` footgun on a string demos are both ruled out).
  const demosDeclared =
    manifestRes.kind === "ok" ? (manifestRes.manifest.demos?.length ?? 0) : 0;
  const deployed =
    manifestRes.kind === "ok" ? (manifestRes.manifest.deployed ?? null) : null;

  // Accumulate anomalies in a local array, then hand the frozen snapshot
  // to the PackageAudit below. Deriving the final shape in one place
  // keeps invariant checks (freeze, read-only array type, no downstream
  // push) local and explicit — rather than mutating the record
  // incrementally as the function walked.
  const anomalies: Anomaly[] = [];

  // Read-error anomalies propagate regardless of manifest state —
  // unreadable dirs are infrastructure failures, not content failures.
  if (specRes.kind === "error") {
    anomalies.push({
      kind: "unreadable-dir",
      dir: e2eDir,
      error: specRes.error,
    });
  }
  if (qaRes.kind === "error") {
    anomalies.push({
      kind: "unreadable-dir",
      dir: qaDir,
      error: qaRes.error,
    });
  }

  if (manifestRes.kind === "missing") {
    anomalies.push({ kind: "missing-manifest" });
  } else if (manifestRes.kind === "malformed") {
    anomalies.push({
      kind: "malformed-manifest",
      error: manifestRes.error,
    });
  } else {
    const manifest = manifestRes.manifest;

    // Only report count-parity anomalies when we actually managed to
    // read the directories — otherwise we'd double-report (unreadable
    // + phantom mismatch).
    if (specRes.kind !== "error" && specRes.count !== demosDeclared) {
      anomalies.push({
        kind: "count-mismatch",
        dimension: "spec",
        expected: demosDeclared,
        actual: specRes.count,
      });
    }
    if (qaRes.kind !== "error" && qaRes.count !== demosDeclared) {
      anomalies.push({
        kind: "count-mismatch",
        dimension: "qa",
        expected: demosDeclared,
        actual: qaRes.count,
      });
    }

    if (manifest.deployed !== true) {
      anomalies.push({
        kind: "not-deployed",
        state: manifest.deployed === false ? "false" : "unset",
      });
    }

    // Born-in-showcase packages have no Dojo counterpart by design;
    // skip the "missing examples source" check for them.
    if (examplesSource === null && !BORN_IN_SHOWCASE.has(slug)) {
      anomalies.push({ kind: "missing-examples" });
    }
  }

  return {
    slug,
    manifest: manifestRes,
    demosDeclared,
    spec: toCountState(specRes),
    qa: toCountState(qaRes),
    deployed,
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
      return `malformed manifest.yaml: ${a.error}`;
    case "unreadable-dir":
      return `could not read ${a.dir}: ${a.error}`;
    case "count-mismatch":
      return `${a.dimension} count (${a.actual}) != demos (${a.expected})`;
    case "not-deployed":
      return `deployed=${a.state}`;
    case "missing-examples":
      return "no examples/integrations counterpart";
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
const TABLE_COLUMNS: ReadonlyArray<{
  key: string;
  label: string;
  align: "left" | "right";
  value: (a: PackageAudit) => string;
}> = [
  { key: "slug", label: "slug", align: "left", value: (a) => a.slug },
  {
    key: "demos",
    label: "demos",
    align: "right",
    value: (a) => String(a.demosDeclared),
  },
  {
    key: "specs",
    label: "specs",
    align: "right",
    value: (a) => countLabel(a.spec),
  },
  { key: "qa", label: "qa", align: "right", value: (a) => countLabel(a.qa) },
  {
    key: "deployed",
    label: "deployed",
    align: "right",
    value: (a) => (a.deployed === null ? "?" : a.deployed ? "yes" : "no"),
  },
  {
    key: "examples src",
    label: "examples src",
    align: "left",
    value: (a) => a.examplesSource ?? "—",
  },
];

function renderTable(audits: PackageAudit[]): string {
  // Empty-list guard: no rows means nothing to align to but the header
  // widths. Without this, `Math.max(h.length, ...[])` still works (the
  // spread of an empty array disappears) but the table would consist of
  // header + divider only, which the caller almost never actually wants.
  // Short-circuit with a dedicated "(no packages)" note instead.
  if (audits.length === 0) {
    return "  (no packages)";
  }

  const rows = audits.map((a) => TABLE_COLUMNS.map((col) => col.value(a)));

  const widths = TABLE_COLUMNS.map((col, i) =>
    Math.max(col.label.length, ...rows.map((r) => r[i].length)),
  );

  const fmtRow = (cells: readonly string[]) =>
    "  " +
    cells
      .map((c, i) =>
        TABLE_COLUMNS[i].align === "left"
          ? padRight(c, widths[i])
          : padLeft(c, widths[i]),
      )
      .join("  ");

  const headerRow = TABLE_COLUMNS.map((col) => col.label);
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
      const reason =
        p?.anomalies.find((a) => a.kind === "unreadable-dir") ?? null;
      const msg = reason ? anomalyMessage(reason) : "could not read";
      lines.push(`    - ${slug}: ${msg}`);
    }
  }

  if (countMismatches.length > 0) {
    lines.push("");
    lines.push("  Count mismatches (demos != specs != qa):");
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
      const state = p?.deployed === null ? "unset" : "false";
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

function buildReport(slugs: string[], cfg: AuditConfig): AuditReport {
  const packages = slugs.map((s) => auditPackage(s, cfg));

  // Classify via tagged-union `Anomaly.kind` — NOT via string-prefix
  // matching. String matching was brittle and could silently drop real
  // mismatches behind typos.
  //
  // countMismatches per-dimension filter: suppress a spec-dimension
  // mismatch only if the SPEC dir was unreadable, and suppress a
  // qa-dimension mismatch only if the QA dir was unreadable. A package
  // with an unreadable spec dir AND a real QA mismatch still appears in
  // countMismatches (for the QA dimension).
  const countMismatches = packages
    .filter((p) => p.manifest.kind === "ok")
    .filter((p) => {
      const specUnreadable = p.spec.state === "unreadable";
      const qaUnreadable = p.qa.state === "unreadable";
      const hasSpecMismatch = p.anomalies.some(
        (a) => a.kind === "count-mismatch" && a.dimension === "spec",
      );
      const hasQaMismatch = p.anomalies.some(
        (a) => a.kind === "count-mismatch" && a.dimension === "qa",
      );
      const visibleSpec = hasSpecMismatch && !specUnreadable;
      const visibleQa = hasQaMismatch && !qaUnreadable;
      return visibleSpec || visibleQa;
    })
    .map((p) => p.slug);
  const notDeployed = packages
    .filter((p) => p.manifest.kind === "ok" && p.deployed !== true)
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
  const malformedManifest = packages
    .filter((p) => p.manifest.kind === "malformed")
    .map((p) => p.slug);
  const unreadable = packages
    .filter((p) => p.anomalies.some((a) => a.kind === "unreadable-dir"))
    .map((p) => p.slug);

  const withAnomalies = packages.filter((p) => p.anomalies.length > 0).length;

  // Deep-freeze audit records so downstream consumers can't accidentally
  // mutate them. We freeze the record AND its inner mutable containers
  // (anomalies, warnings, spec, qa, and the manifest variant) because a
  // shallow `Object.freeze` would still leave `audit.anomalies.push(…)`
  // working — the slug-string buckets below are already immutable (new
  // arrays of primitives) but the per-package record was not.
  for (const p of packages) {
    Object.freeze(p.anomalies);
    Object.freeze(p.warnings);
    Object.freeze(p.spec);
    Object.freeze(p.qa);
    Object.freeze(p.manifest);
    // The "ok" variant carries a nested Manifest object; freezing that
    // too (shallowly) prevents callers from rewriting e.g. `deployed`
    // on a shared reference. demos arrays are plain data from yaml.parse
    // and are NOT frozen (we preserve yaml's mutable shape for backward
    // compatibility with consumers that re-sort/rewrite).
    if (p.manifest.kind === "ok") Object.freeze(p.manifest.manifest);
    Object.freeze(p);
  }

  const hasAnomalies = withAnomalies > 0;
  const exitCode = hasAnomalies ? EXIT_ANOMALIES : 0;

  return {
    hasAnomalies,
    exitCode,
    packages,
    anomalies: {
      countMismatches,
      notDeployed,
      missingExamples,
      missingManifest,
      malformedManifest,
      unreadable,
    },
    totals: {
      total: packages.length,
      clean: packages.length - withAnomalies,
      withAnomalies,
    },
  };
}

interface ParsedArgs {
  json: boolean;
  slug: string | null;
  help: boolean;
  errors: string[];
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
  const errors: string[] = [];
  // Track which flags have already been set so duplicates surface as
  // explicit errors instead of being silently overwritten.
  const seenJson = { set: false };
  const seenSlug = { set: false };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") {
      if (seenJson.set) {
        errors.push("--json specified more than once");
      }
      seenJson.set = true;
      json = true;
    } else if (a === "--slug") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        errors.push(
          `--slug requires a value (not a flag like "${next ?? "(end of argv)"}")`,
        );
      } else {
        if (seenSlug.set) {
          errors.push(
            `--slug specified more than once (first="${slug}", second="${next}")`,
          );
        }
        seenSlug.set = true;
        slug = next;
        i++;
      }
    } else if (a === "--help" || a === "-h") {
      help = true;
    } else {
      errors.push(`unrecognised argument: ${a}`);
    }
  }
  return { json, slug, help, errors };
}

const HELP_TEXT = [
  "Usage: npx tsx showcase/scripts/audit.ts [options]",
  "",
  "Options:",
  "  --json         Emit machine-readable JSON instead of a table",
  "  --slug <slug>  Audit only the given showcase package slug",
  "  -h, --help     Show this help",
  "",
  "Examples:",
  "  npx tsx showcase/scripts/audit.ts",
  "  npx tsx showcase/scripts/audit.ts --json",
  "  npx tsx showcase/scripts/audit.ts --slug mastra",
  "  npx tsx showcase/scripts/audit.ts --json --slug mastra",
  "",
  "Output order: summary table → coverage anomalies → overall health.",
  "",
  "Exit codes:",
  "  0 — no anomalies",
  "  1 — anomalies found (see anomaly section, or empty packages dir)",
  "  2 — invalid content / user input (bad args, unknown slug)",
  "  3 — unreadable (packages path missing, not a directory, or fs failure)",
  "  4 — unexpected internal error",
].join("\n");

// Exit-code constants — see the module header JSDoc for the full
// contract. We keep them in one place so the internals stay in sync with
// the CLI HELP_TEXT and the module docstring.
const EXIT_ANOMALIES = 1;
const EXIT_INVALID_CONTENT = 2;
const EXIT_UNREADABLE = 3;
const EXIT_INTERNAL = 4;

// Heuristic: treat TypeError / ReferenceError / RangeError as programmer
// bugs (broken invariant, likely worth a bug report), not as
// infrastructure failures. Everything else that reaches the top-level
// catch is more likely an unhandled I/O or runtime condition. Both
// still land on EXIT_INTERNAL, but the diagnostic wording differs so
// the on-call reader can triage faster.
function isProgrammerBug(e: unknown): boolean {
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
    // "exists as a dir". The old code went straight to readdirSync which
    // would throw ENOTDIR — but that was caught and collapsed into
    // "empty packages" (exit 1), which masked the real cause.
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

    const report = buildReport(slugs, cfg);

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
      console.log(renderTable(report.packages));
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

// Only run when executed directly. Uses path.resolve on both sides because
// tsx and pnpm can realpath symlinks or hand argv[1] in non-canonical form,
// which breaks a naive `===` comparison.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main();
}

export {
  auditPackage,
  buildReport,
  listShowcasePackageSlugs,
  readManifest,
  countFiles,
  findExamplesSource,
  parseArgs,
  anomalyMessage,
  UnreadableDirError,
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
};
