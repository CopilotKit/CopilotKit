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
 *   - Every declared demo has a matching src/app/demos/<id>/ directory.
 *
 * SHOULD checks (warn on stderr, do not fail):
 *   - Every declared demo has a matching tests/e2e/<id>.spec.ts.
 *   - Every declared demo has a matching qa/<id>.md.
 *   - Package demo count matches the baseline (default: 9).
 *   - spec count == demo count.
 *   - qa count >= demo count.
 *
 * Usage (from showcase/ or showcase/scripts/):
 *   npx tsx scripts/validate-parity.ts
 *   # or:
 *   cd showcase/scripts && npx tsx validate-parity.ts
 *
 * The script resolves packages relative to its own file location, so the
 * invocation cwd does not matter as long as the `yaml` dep resolves (it
 * lives under showcase/scripts/node_modules, matching the pattern used by
 * validate-constraints.ts and generate-registry.ts).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PACKAGES_DIR = path.join(ROOT, "packages");

// Baseline expected demo count per package. Packages that deviate from this
// are flagged as warnings (e.g. ones still being built out).
const BASELINE_DEMO_COUNT = 9;

interface ManifestDemo {
  id: string;
  name?: string;
}

interface Manifest {
  slug: string;
  demos?: ManifestDemo[];
}

interface PackageReport {
  slug: string;
  demoIds: string[];
  specFiles: string[];
  qaFiles: string[];
  demoDirs: string[];
  mustErrors: string[];
  warnings: string[];
}

function listDirs(p: string): string[] {
  if (!fs.existsSync(p)) return [];
  return fs
    .readdirSync(p, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function listFiles(p: string, suffix: string): string[] {
  if (!fs.existsSync(p)) return [];
  return fs
    .readdirSync(p, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(suffix))
    .map((d) => d.name);
}

function loadManifest(slug: string): Manifest | null {
  const manifestPath = path.join(PACKAGES_DIR, slug, "manifest.yaml");
  if (!fs.existsSync(manifestPath)) return null;
  const raw = fs.readFileSync(manifestPath, "utf-8");
  return yaml.parse(raw) as Manifest;
}

function auditPackage(slug: string): PackageReport {
  const pkgDir = path.join(PACKAGES_DIR, slug);
  const mustErrors: string[] = [];
  const warnings: string[] = [];

  const manifest = loadManifest(slug);
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

  const demos = manifest.demos ?? [];
  const demoIds = demos.map((d) => d.id);

  const specFiles = listFiles(path.join(pkgDir, "tests", "e2e"), ".spec.ts");
  const qaFiles = listFiles(path.join(pkgDir, "qa"), ".md");
  const demoDirs = listDirs(path.join(pkgDir, "src", "app", "demos"));

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
  if (demoIds.length !== BASELINE_DEMO_COUNT) {
    warnings.push(
      `demo count ${demoIds.length} deviates from baseline ${BASELINE_DEMO_COUNT}`,
    );
  }

  // SHOULD: spec count == demo count (specs may legitimately exceed, e.g.
  // renderer-selector.spec.ts for langgraph-python, so we flag inequality)
  if (specFiles.length !== demoIds.length) {
    warnings.push(
      `spec count ${specFiles.length} != demo count ${demoIds.length}`,
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

function main(): void {
  if (!fs.existsSync(PACKAGES_DIR)) {
    console.error(`[FAIL] packages directory not found: ${PACKAGES_DIR}`);
    process.exit(1);
  }

  const slugs = fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  if (slugs.length === 0) {
    console.error(`[FAIL] no packages found under ${PACKAGES_DIR}`);
    process.exit(1);
  }

  const reports = slugs.map((s) => auditPackage(s));

  let hasMustFailure = false;
  let totalWarnings = 0;

  // Compute column widths for pretty alignment
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

  // Emit MUST errors to stdout (part of the failure report)
  for (const r of reports) {
    for (const err of r.mustErrors) {
      console.log(`[FAIL] ${r.slug}: ${err}`);
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

  process.exit(hasMustFailure ? 1 : 0);
}

main();
