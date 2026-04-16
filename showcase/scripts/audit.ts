/**
 * Showcase Audit CLI
 *
 * Walks showcase/packages/* and emits a human-readable coverage report
 * comparing declared demos vs. e2e spec files vs. QA markdown, plus
 * deployment status and examples/integrations provenance.
 *
 * Usage:
 *   npx tsx showcase/scripts/audit.ts
 *   npx tsx showcase/scripts/audit.ts --json        # machine-readable output
 *   npx tsx showcase/scripts/audit.ts --slug <slug> # single package
 *
 * Output sections (printed in this order):
 *   1. Per-package summary table (slug | demos | specs | qa | deployed | examples src)
 *   2. Coverage anomalies (count mismatches, undeployed, missing examples source)
 *   3. Overall health (pass/fail counts + suggestions)
 *
 * Exit codes:
 *   0 — no anomalies found
 *   1 — one or more anomalies
 *   2 — internal error (bad args, unreadable packages dir, parse failure)
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
import yaml from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Slug map — showcase slug → examples/integrations dir name(s)
//
// Duplicated from migrate-integration-examples.ts (which does not export
// SLUG_MAP); keep in sync. Entries must reference slugs that actually appear
// under showcase/packages/ — dead entries are removed to avoid phantom
// "no examples source" anomalies.
// ---------------------------------------------------------------------------
const SLUG_TO_EXAMPLES: Record<string, string[]> = {
  "langgraph-python": ["langgraph-python"],
  "langgraph-typescript": ["langgraph-js"],
  "langgraph-fastapi": ["langgraph-fastapi"],
  mastra: ["mastra"],
  "crewai-crews": ["crewai-crews"],
  "crewai-flows": ["crewai-flows"],
  "pydantic-ai": ["pydantic-ai"],
  agno: ["agno"],
  llamaindex: ["llamaindex"],
  "google-adk": ["adk"],
  "ms-agent-dotnet": ["ms-agent-framework-dotnet"],
  "ms-agent-python": ["ms-agent-framework-python"],
  strands: ["strands-python"],
  "agent-spec-langgraph": ["agent-spec"],
  "mcp-apps": ["mcp-apps"],
};

// Packages intentionally without a Dojo counterpart. Mirrors the set
// maintained in validate-pins.ts so the two tools agree on what counts as
// "working-as-designed." Updating one without the other produces
// inconsistent audit output.
const BORN_IN_SHOWCASE = new Set<string>([
  "ag2",
  "claude-sdk-python",
  "claude-sdk-typescript",
  "langroid",
  "spring-ai",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ManifestDemo {
  id: string;
  name?: string;
}

interface Manifest {
  slug: string;
  name?: string;
  deployed?: boolean;
  demos?: ManifestDemo[];
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

interface PackageAudit {
  slug: string;
  manifestFound: boolean;
  manifestMalformed: boolean;
  demosDeclared: number;
  specCount: number;
  qaCount: number;
  deployed: boolean | null;
  examplesSource: string | null; // relative path from repo root, or null
  anomalies: string[];
}

interface AuditReport {
  packages: PackageAudit[];
  anomalies: {
    countMismatches: PackageAudit[];
    notDeployed: PackageAudit[];
    missingExamples: PackageAudit[];
    missingManifest: PackageAudit[];
    malformedManifest: PackageAudit[];
    unreadable: PackageAudit[];
  };
  totals: {
    total: number;
    clean: number;
    withAnomalies: number;
  };
}

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
 * to allow test subprocesses to point at a fixture tree. When unset, uses
 * the script's canonical location (showcase/scripts/audit.ts → showcase/).
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

function listShowcasePackageSlugs(cfg: AuditConfig): string[] {
  if (!fs.existsSync(cfg.packagesDir)) return [];
  try {
    return fs
      .readdirSync(cfg.packagesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(
      `audit: could not read packages dir ${cfg.packagesDir}: ${msg}\n`,
    );
    return [];
  }
}

/**
 * Distinguishes three outcomes for a package's manifest.yaml:
 *   - missing   → file does not exist
 *   - malformed → file exists but YAML parse failed
 *   - ok        → file parsed successfully
 *
 * The previous implementation collapsed malformed into missing with an
 * empty catch{}, which silently reported "missing manifest.yaml" for
 * broken YAML and made debugging misleading.
 */
function readManifest(slug: string, cfg: AuditConfig): ManifestResult {
  const p = path.join(cfg.packagesDir, slug, "manifest.yaml");
  if (!fs.existsSync(p)) return { kind: "missing" };
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf-8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: "malformed", error: `read failed: ${msg}` };
  }
  try {
    const parsed = yaml.parse(raw) as Manifest;
    return { kind: "ok", manifest: parsed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: "malformed", error: msg };
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

/**
 * Resolve a showcase slug to its examples/integrations counterpart.
 * Returns null if no candidate exists (which is OK for born-in-showcase
 * packages).
 *
 * statSync is wrapped in try/catch — between existsSync and statSync
 * there's a real (if rare) race window on network filesystems, and we
 * don't want a TOCTOU race to crash the whole audit.
 */
function findExamplesSource(slug: string, cfg: AuditConfig): string | null {
  const candidates = SLUG_TO_EXAMPLES[slug] ?? [slug];
  for (const candidate of candidates) {
    const full = path.join(cfg.examplesIntegrationsDir, candidate);
    if (!fs.existsSync(full)) continue;
    try {
      if (fs.statSync(full).isDirectory()) {
        return path.relative(cfg.repoRoot, full);
      }
    } catch {
      // Race condition or permission issue — treat as not-found and
      // continue searching the remaining candidates.
      continue;
    }
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
  const examplesSource = findExamplesSource(slug, cfg);

  const audit: PackageAudit = {
    slug,
    manifestFound: manifestRes.kind === "ok",
    manifestMalformed: manifestRes.kind === "malformed",
    demosDeclared:
      manifestRes.kind === "ok" ? (manifestRes.manifest.demos?.length ?? 0) : 0,
    specCount: specRes.count,
    qaCount: qaRes.count,
    deployed:
      manifestRes.kind === "ok"
        ? (manifestRes.manifest.deployed ?? null)
        : null,
    examplesSource,
    anomalies: [],
  };

  // Read-error anomalies propagate regardless of manifest state —
  // unreadable dirs are infrastructure failures, not content failures.
  if (specRes.kind === "error") {
    audit.anomalies.push(`could not read ${e2eDir}: ${specRes.error}`);
  }
  if (qaRes.kind === "error") {
    audit.anomalies.push(`could not read ${qaDir}: ${qaRes.error}`);
  }

  if (manifestRes.kind === "missing") {
    audit.anomalies.push("missing manifest.yaml");
    return audit;
  }
  if (manifestRes.kind === "malformed") {
    audit.anomalies.push(`malformed manifest.yaml: ${manifestRes.error}`);
    return audit;
  }

  const manifest = manifestRes.manifest;
  const demos = audit.demosDeclared;

  // Only report count-parity anomalies when we actually managed to read
  // the directories — otherwise we'd double-report (unreadable + phantom
  // mismatch).
  if (specRes.kind !== "error" && specRes.count !== demos) {
    audit.anomalies.push(`spec count (${specRes.count}) != demos (${demos})`);
  }
  if (qaRes.kind !== "error" && qaRes.count !== demos) {
    audit.anomalies.push(`qa count (${qaRes.count}) != demos (${demos})`);
  }

  if (manifest.deployed !== true) {
    audit.anomalies.push(
      `deployed=${manifest.deployed === false ? "false" : "unset"}`,
    );
  }

  // Born-in-showcase packages have no Dojo counterpart by design; skip
  // the "missing examples source" check for them.
  if (examplesSource === null && !BORN_IN_SHOWCASE.has(slug)) {
    audit.anomalies.push("no examples/integrations counterpart");
  }

  return audit;
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

function renderTable(audits: PackageAudit[]): string {
  const headers = [
    "slug",
    "demos",
    "specs",
    "qa",
    "deployed",
    "examples src",
  ] as const;
  const rows = audits.map((a) => [
    a.slug,
    String(a.demosDeclared),
    String(a.specCount),
    String(a.qaCount),
    a.deployed === null ? "?" : a.deployed ? "yes" : "no",
    a.examplesSource ?? "—",
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );

  const fmtRow = (cells: string[]) =>
    "  " +
    cells
      .map((c, i) =>
        i === 0 || i === 5 ? padRight(c, widths[i]) : padLeft(c, widths[i]),
      )
      .join("  ");

  const divider = "  " + widths.map((w) => "-".repeat(w)).join("  ");

  return [fmtRow([...headers]), divider, ...rows.map(fmtRow)].join("\n");
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

  lines.push("Coverage anomalies");
  lines.push("------------------");

  if (missingManifest.length > 0) {
    lines.push("");
    lines.push("  Missing manifest.yaml:");
    for (const p of missingManifest) lines.push(`    - ${p.slug}`);
  }

  if (malformedManifest.length > 0) {
    lines.push("");
    lines.push("  Malformed manifest.yaml:");
    for (const p of malformedManifest) {
      // Surface the first matching anomaly string for context.
      const reason =
        p.anomalies.find((s) => s.startsWith("malformed manifest.yaml")) ??
        "malformed manifest.yaml";
      lines.push(`    - ${p.slug}: ${reason}`);
    }
  }

  if (unreadable.length > 0) {
    lines.push("");
    lines.push("  Unreadable directories:");
    for (const p of unreadable) {
      const reason =
        p.anomalies.find((s) => s.startsWith("could not read")) ??
        "could not read";
      lines.push(`    - ${p.slug}: ${reason}`);
    }
  }

  if (countMismatches.length > 0) {
    lines.push("");
    lines.push("  Count mismatches (demos != specs != qa):");
    for (const p of countMismatches) {
      lines.push(
        `    - ${p.slug}: demos=${p.demosDeclared} specs=${p.specCount} qa=${p.qaCount}`,
      );
    }
  }

  if (notDeployed.length > 0) {
    lines.push("");
    lines.push("  Not deployed (deployed != true):");
    for (const p of notDeployed) {
      const state = p.deployed === null ? "unset" : "false";
      lines.push(`    - ${p.slug} (${state})`);
    }
  }

  if (missingExamples.length > 0) {
    lines.push("");
    lines.push("  No examples/integrations counterpart:");
    for (const p of missingExamples) {
      lines.push(`    - ${p.slug}`);
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
      "Add the slug to SLUG_TO_EXAMPLES in audit.ts, or add it to BORN_IN_SHOWCASE if the package has no Dojo counterpart.",
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

  const countMismatches = packages.filter(
    (p) =>
      p.manifestFound &&
      (p.specCount !== p.demosDeclared || p.qaCount !== p.demosDeclared) &&
      !p.anomalies.some((a) => a.startsWith("could not read")),
  );
  const notDeployed = packages.filter(
    (p) => p.manifestFound && p.deployed !== true,
  );
  const missingExamples = packages.filter(
    (p) =>
      p.manifestFound &&
      p.examplesSource === null &&
      !BORN_IN_SHOWCASE.has(p.slug),
  );
  const missingManifest = packages.filter(
    (p) => !p.manifestFound && !p.manifestMalformed,
  );
  const malformedManifest = packages.filter((p) => p.manifestMalformed);
  const unreadable = packages.filter((p) =>
    p.anomalies.some((a) => a.startsWith("could not read")),
  );

  const withAnomalies = packages.filter((p) => p.anomalies.length > 0).length;

  return {
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

/**
 * Flag-aware argv parser. Critically: `--slug --json` is rejected rather
 * than silently consuming `--json` as the slug value. Returns a list of
 * parse errors so the caller can distinguish them from package anomalies
 * (exit code 2, not 1).
 */
function parseArgs(argv: string[]): ParsedArgs {
  let json = false;
  let slug: string | null = null;
  let help = false;
  const errors: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") {
      json = true;
    } else if (a === "--slug") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        errors.push(
          `--slug requires a value (not a flag like "${next ?? "(end of argv)"}")`,
        );
      } else {
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
  "Output order: summary table → coverage anomalies → overall health.",
  "",
  "Exit codes:",
  "  0 — no anomalies",
  "  1 — anomalies found (see anomaly section)",
  "  2 — internal error (bad args, unreadable packages dir, missing fixtures)",
].join("\n");

function main(): void {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) {
      console.log(HELP_TEXT);
      process.exit(0);
    }
    if (parsed.errors.length > 0) {
      for (const err of parsed.errors) {
        console.error(`audit: ${err}`);
      }
      console.error("");
      console.error(HELP_TEXT);
      process.exit(2);
    }

    const cfg = buildCliConfig();

    if (!fs.existsSync(cfg.packagesDir)) {
      console.error(`audit: packages dir does not exist: ${cfg.packagesDir}`);
      process.exit(2);
    }

    const allSlugs = listShowcasePackageSlugs(cfg);

    if (parsed.slug && !allSlugs.includes(parsed.slug)) {
      console.error(`audit: unknown showcase package slug: ${parsed.slug}`);
      console.error(
        `audit: available slugs: ${allSlugs.join(", ") || "(none)"}`,
      );
      process.exit(2);
    }

    const slugs = parsed.slug ? [parsed.slug] : allSlugs;

    if (slugs.length === 0) {
      console.error(
        `audit: packages dir is empty: ${cfg.packagesDir} — nothing to audit`,
      );
      // Empty packages dir is a genuine anomaly (working-as-designed audit
      // should have something to audit), so exit 1 not 2.
      process.exit(1);
    }

    const report = buildReport(slugs, cfg);

    if (parsed.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      console.log("Per-package summary");
      console.log("-------------------");
      console.log(renderTable(report.packages));
      console.log("");
      console.log(renderAnomalySection(report));
      console.log("");
      console.log(renderHealthSection(report));
    }

    const hasAnomalies = report.totals.withAnomalies > 0;
    process.exit(hasAnomalies ? 1 : 0);
  } catch (e) {
    const msg = e instanceof Error ? e.stack || e.message : String(e);
    console.error(`audit: internal error: ${msg}`);
    process.exit(2);
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
  BORN_IN_SHOWCASE,
  SLUG_TO_EXAMPLES,
};
export type { AuditReport, PackageAudit, AuditConfig, Manifest };
