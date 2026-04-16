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
 * Output sections:
 *   1. Per-package summary table (slug | demos | specs | qa | deployed | examples src)
 *   2. Coverage anomalies (count mismatches, undeployed, missing examples source)
 *   3. Overall health (pass/fail counts + suggestions)
 *
 * Exit codes:
 *   0 — no anomalies found
 *   1 — one or more anomalies (details printed above the summary)
 *
 * No new npm deps. Reuses `yaml` which is already declared in
 * showcase/scripts/package.json. Self-sufficient: does not depend on any
 * sibling validator scripts that may or may not exist.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPTS_DIR = __dirname;
const SHOWCASE_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SHOWCASE_ROOT, "..");
const PACKAGES_DIR = path.join(SHOWCASE_ROOT, "packages");
const EXAMPLES_INTEGRATIONS_DIR = path.join(
  REPO_ROOT,
  "examples",
  "integrations",
);

// ---------------------------------------------------------------------------
// Slug map — slug → examples/integrations dir name(s)
//
// We try to import the authoritative SLUG_MAP from migrate-integration-examples.ts
// if it's exported. If not (it isn't, at time of writing), we fall back to this
// inline copy derived from that file. Keep in sync.
// ---------------------------------------------------------------------------
const SLUG_TO_EXAMPLES: Record<string, string[]> = {
  "langgraph-python": ["langgraph-python"],
  "langgraph-typescript": ["langgraph-js"],
  "langgraph-fastapi": ["langgraph-fastapi"],
  mastra: ["mastra"],
  crewai: ["crewai-crews", "crewai-flows"],
  pydanticai: ["pydantic-ai"],
  agno: ["agno"],
  llamaindex: ["llamaindex"],
  "google-adk": ["adk"],
  "maf-dotnet": ["ms-agent-framework-dotnet"],
  "maf-python": ["ms-agent-framework-python"],
  "aws-strands": ["strands-python"],
  "agent-spec-langgraph": ["agent-spec"],
  a2a: ["a2a-a2ui", "a2a-middleware"],
  "mcp-apps": ["mcp-apps"],
  // Additional slugs used by showcase directory names that diverge from the
  // migrate script's SLUG_MAP. Tried in order.
  "pydantic-ai": ["pydantic-ai"],
  "ms-agent-python": ["ms-agent-framework-python"],
  "ms-agent-dotnet": ["ms-agent-framework-dotnet"],
  strands: ["strands-python"],
};

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

interface PackageAudit {
  slug: string;
  manifestFound: boolean;
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
  };
  totals: {
    total: number;
    clean: number;
    withAnomalies: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listShowcasePackageSlugs(): string[] {
  if (!fs.existsSync(PACKAGES_DIR)) return [];
  return fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function readManifest(slug: string): Manifest | null {
  const p = path.join(PACKAGES_DIR, slug, "manifest.yaml");
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return yaml.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

function countFiles(dir: string, extFilter: (name: string) => boolean): number {
  if (!fs.existsSync(dir)) return 0;
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && extFilter(d.name)).length;
  } catch {
    return 0;
  }
}

function findExamplesSource(slug: string): string | null {
  const candidates = SLUG_TO_EXAMPLES[slug] ?? [slug];
  for (const candidate of candidates) {
    const full = path.join(EXAMPLES_INTEGRATIONS_DIR, candidate);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      return path.relative(REPO_ROOT, full);
    }
  }
  return null;
}

function auditPackage(slug: string): PackageAudit {
  const manifest = readManifest(slug);
  const pkgDir = path.join(PACKAGES_DIR, slug);
  const e2eDir = path.join(pkgDir, "tests", "e2e");
  const qaDir = path.join(pkgDir, "qa");

  const specCount = countFiles(e2eDir, (n) => n.endsWith(".spec.ts"));
  const qaCount = countFiles(qaDir, (n) => n.endsWith(".md"));
  const examplesSource = findExamplesSource(slug);

  const audit: PackageAudit = {
    slug,
    manifestFound: manifest !== null,
    demosDeclared: manifest?.demos?.length ?? 0,
    specCount,
    qaCount,
    deployed: manifest?.deployed ?? null,
    examplesSource,
    anomalies: [],
  };

  if (!manifest) {
    audit.anomalies.push("missing manifest.yaml");
    return audit;
  }

  // Count parity: demos should roughly match specs and qa
  const demos = audit.demosDeclared;
  if (specCount !== demos) {
    audit.anomalies.push(`spec count (${specCount}) != demos (${demos})`);
  }
  if (qaCount !== demos) {
    audit.anomalies.push(`qa count (${qaCount}) != demos (${demos})`);
  }

  if (manifest.deployed !== true) {
    audit.anomalies.push(
      `deployed=${manifest.deployed === false ? "false" : "unset"}`,
    );
  }

  if (examplesSource === null) {
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

  const { countMismatches, notDeployed, missingExamples, missingManifest } =
    report.anomalies;

  lines.push("Coverage anomalies");
  lines.push("------------------");

  if (missingManifest.length > 0) {
    lines.push("");
    lines.push("  Missing manifest.yaml:");
    for (const p of missingManifest) lines.push(`    - ${p.slug}`);
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
      "Add an entry to SLUG_MAP in migrate-integration-examples.ts, or confirm this package has no examples/integrations source.",
    );
  }
  if (report.anomalies.missingManifest.length > 0) {
    suggestions.push(
      "Create a manifest.yaml for each package directory or remove the directory.",
    );
  }

  lines.push("  Suggestions:");
  for (const s of suggestions) lines.push(`    - ${s}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function buildReport(slugs: string[]): AuditReport {
  const packages = slugs.map(auditPackage);

  const countMismatches = packages.filter(
    (p) =>
      p.manifestFound &&
      (p.specCount !== p.demosDeclared || p.qaCount !== p.demosDeclared),
  );
  const notDeployed = packages.filter(
    (p) => p.manifestFound && p.deployed !== true,
  );
  const missingExamples = packages.filter(
    (p) => p.manifestFound && p.examplesSource === null,
  );
  const missingManifest = packages.filter((p) => !p.manifestFound);

  const withAnomalies = packages.filter((p) => p.anomalies.length > 0).length;

  return {
    packages,
    anomalies: {
      countMismatches,
      notDeployed,
      missingExamples,
      missingManifest,
    },
    totals: {
      total: packages.length,
      clean: packages.length - withAnomalies,
      withAnomalies,
    },
  };
}

function parseArgs(argv: string[]): { json: boolean; slug: string | null } {
  let json = false;
  let slug: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--slug" && argv[i + 1]) slug = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: npx tsx showcase/scripts/audit.ts [options]",
          "",
          "Options:",
          "  --json         Emit machine-readable JSON instead of a table",
          "  --slug <slug>  Audit only the given showcase package slug",
          "  -h, --help     Show this help",
          "",
          "Exit codes:",
          "  0 — no anomalies",
          "  1 — anomalies found (details printed before the table)",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  return { json, slug };
}

function main() {
  const { json, slug } = parseArgs(process.argv.slice(2));
  const allSlugs = listShowcasePackageSlugs();
  const slugs = slug ? [slug] : allSlugs;

  if (slug && !allSlugs.includes(slug)) {
    console.error(`Unknown showcase package slug: ${slug}`);
    console.error(
      `Available: ${allSlugs.join(", ") || "(none — showcase/packages is empty)"}`,
    );
    process.exit(1);
  }

  const report = buildReport(slugs);

  if (json) {
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
}

// Only run when executed directly
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { auditPackage, buildReport, listShowcasePackageSlugs };
export type { AuditReport, PackageAudit };
