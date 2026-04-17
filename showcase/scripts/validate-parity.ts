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
 *   - Package demo count matches the baseline (default: 9).
 *   - spec count >= demo count (spec count exceeding demo count is
 *     legitimate — e.g. renderer-selector.spec.ts for langgraph-python —
 *     so only UNDER-coverage is flagged).
 *   - qa count >= demo count.
 *
 * Usage (from showcase/ or showcase/scripts/):
 *   npx tsx scripts/validate-parity.ts
 *   # or:
 *   cd showcase/scripts && npx tsx validate-parity.ts
 *
 * Exit codes:
 *   0 — no MUST failures
 *   1 — one or more MUST failures
 *   2 — internal error (uncaught exception during validation)
 *
 * The script resolves packages relative to its own file location, so the
 * invocation cwd does not matter as long as the `yaml` dep resolves (it
 * lives under showcase/scripts/node_modules, matching the pattern used by
 * validate-constraints.ts and generate-registry.ts).
 */

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

// Baseline expected demo count per package. Packages that deviate from this
// are flagged as warnings (e.g. ones still being built out).
const BASELINE_DEMO_COUNT = 9;

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

export function listDirs(p: string): string[] {
  if (!fs.existsSync(p)) return [];
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[WARN] failed to read directory ${p}: ${msg}`);
    return [];
  }
}

export function listFiles(p: string, suffix: string): string[] {
  if (!fs.existsSync(p)) return [];
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(suffix))
      .map((d) => d.name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[WARN] failed to read directory ${p}: ${msg}`);
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
 *   - Error when the file exists but parseManifest returns "malformed"
 *     or "unreadable". Kept as a throw so existing callers (and the
 *     test contract — see __tests__/validate-parity.test.ts) can
 *     convert it into a package-level mustError in a try/catch.
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
      throw new Error(parsed.error);
    case "unreadable":
      throw new Error(parsed.error);
  }
}

export function auditPackage(
  slug: string,
  packagesDir: string = DEFAULT_PACKAGES_DIR,
): PackageReport {
  const pkgDir = path.join(packagesDir, slug);
  const mustErrors: string[] = [];
  const warnings: string[] = [];

  let manifest: Manifest | null;
  try {
    manifest = loadManifest(slug, packagesDir);
  } catch (err) {
    // Malformed YAML: flag this package but let the rest of the run proceed.
    const msg = err instanceof Error ? err.message : String(err);
    mustErrors.push(`unparseable manifest.yaml: ${msg}`);
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

  // yaml.parse can return non-object values for scalar / array YAML (e.g.
  // `hello` parses to the string "hello"; `- a\n- b` parses to an array).
  // Treat anything that isn't a plain object as an invalid manifest rather
  // than silently reading `.demos` off it and reporting a 0-demo package.
  if (typeof manifest !== "object" || Array.isArray(manifest)) {
    mustErrors.push(
      `invalid manifest.yaml: expected a mapping, got ${
        Array.isArray(manifest) ? "array" : typeof manifest
      }`,
    );
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

  // SHOULD: spec count >= demo count. Spec count EXCEEDING demo count is
  // legitimate (e.g. renderer-selector.spec.ts for langgraph-python covers
  // cross-demo behaviour and is intentionally not tied to a declared demo),
  // so we only warn on UNDER-coverage.
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

export function main(packagesDir: string = DEFAULT_PACKAGES_DIR): void {
  if (!fs.existsSync(packagesDir)) {
    console.error(`[FAIL] packages directory not found: ${packagesDir}`);
    process.exit(1);
  }

  const slugs = fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  if (slugs.length === 0) {
    console.error(`[FAIL] no packages found under ${packagesDir}`);
    process.exit(1);
  }

  const reports = slugs.map((s) => auditPackage(s, packagesDir));

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

  process.exit(hasMustFailure ? 1 : 0);
}

// Only invoke main() when this file is run directly (not when imported by
// tests). Matches the isMain guard pattern used by audit.ts.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (err) {
    // Top-level safety net: surface internal errors with exit code 2 so
    // they are distinguishable from legitimate MUST failures (exit 1).
    const msg = err instanceof Error ? err.stack || err.message : String(err);
    console.error(`[INTERNAL ERROR] validate-parity crashed: ${msg}`);
    process.exit(2);
  }
}
