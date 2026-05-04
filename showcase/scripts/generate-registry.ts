// Registry Generator
//
// Scans showcase/integrations/*/manifest.yaml, validates each against the
// manifest JSON schema, and produces showcase/shell/src/data/registry.json.
//
// Also scans showcase/integrations/agents/<fw>/manifest.yaml (new-shape) and
// merges — new-shape wins when both old and new exist for the same slug.
//
// Usage: npx tsx showcase/scripts/generate-registry.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { validateManifestConstraints } from "./validate-constraints.js";
import { parseManifestV2 } from "./lib/manifest-v2.js";
import { parseDemoCatalog } from "./lib/demos-yaml.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const PACKAGES_DIR = path.join(ROOT, "integrations");
const SCHEMA_PATH = path.join(ROOT, "shared", "manifest.schema.json");
const FEATURE_REGISTRY_PATH = path.join(
  ROOT,
  "shared",
  "feature-registry.json",
);
// Registry is consumed by ALL shells:
//   - shell: home grid, integrations catalog, matrix, middleware
//   - shell-docs: docs routes (framework lookup, MDX renderer)
//   - shell-dojo: dojo app's integration grid and demo columns
// so we multi-emit. constraints.json is shell-only (integration-explorer).
const SHELL_OUTPUT_DIR = path.join(ROOT, "shell", "src", "data");
const SHELL_DOCS_OUTPUT_DIR = path.join(ROOT, "shell-docs", "src", "data");
const SHELL_DOJO_OUTPUT_DIR = path.join(ROOT, "shell-dojo", "src", "data");
const SHELL_DASHBOARD_OUTPUT_DIR = path.join(
  ROOT,
  "shell-dashboard",
  "src",
  "data",
);
const OUTPUT_DIRS = [
  SHELL_OUTPUT_DIR,
  SHELL_DOCS_OUTPUT_DIR,
  SHELL_DOJO_OUTPUT_DIR,
  SHELL_DASHBOARD_OUTPUT_DIR,
];
const PACKAGES_JSON_PATH = path.join(ROOT, "shared", "packages.json");
const CONSTRAINTS_PATH = path.join(ROOT, "shared", "constraints.yaml");
const CONSTRAINTS_OUTPUT_PATH = path.join(SHELL_OUTPUT_DIR, "constraints.json");

const UNIFIED_FRONTEND_URL =
  process.env.SHOWCASE_INTEGRATIONS_NEXTJS_URL ??
  "https://showcase-integrations.copilotkit.ai";

function loadSchema() {
  const raw = fs.readFileSync(SCHEMA_PATH, "utf-8");
  return JSON.parse(raw);
}

function loadFeatureRegistry() {
  const raw = fs.readFileSync(FEATURE_REGISTRY_PATH, "utf-8");
  return JSON.parse(raw);
}

type DocsLinkEntry = {
  og_docs_url: string | null;
  shell_docs_path: string | null;
};

type DocsLinks = {
  features: Record<string, DocsLinkEntry>;
};

/**
 * Load per-package docs-links.json. Returns best-effort normalized overrides
 * ({ features: { <feature_id>: { og_docs_url, shell_docs_path } } }).
 *
 * Missing file -> empty overrides. A file with the older shape (e.g. using
 * `shell_docs_url` instead of `shell_docs_path`) is treated as stale: we
 * still merge what we can without erroring.
 *
 * A completely malformed JSON file IS a build-blocking error: the caller
 * must pass `errors` so the failure surfaces in the aggregated error list
 * and `main()`'s `process.exit(1)` path fires. Previously we just
 * `console.warn`ed, which let CI continue green with a silently broken
 * override file on disk.
 */
function loadDocsLinks(packageDir: string, errors: string[]): DocsLinks {
  const docsLinksPath = path.join(packageDir, "docs-links.json");
  if (!fs.existsSync(docsLinksPath)) {
    return { features: {} };
  }

  try {
    const raw = fs.readFileSync(docsLinksPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      features?: Record<string, Record<string, unknown>>;
    };

    const features: Record<string, DocsLinkEntry> = {};
    const rawFeatures = parsed?.features ?? {};
    for (const [featureId, entry] of Object.entries(rawFeatures)) {
      if (!entry || typeof entry !== "object") continue;
      const og =
        typeof entry.og_docs_url === "string" ? entry.og_docs_url : null;
      // Preferred key is `shell_docs_path`; fall back to legacy
      // `shell_docs_url` so older files still contribute something.
      const shellPath =
        typeof entry.shell_docs_path === "string"
          ? entry.shell_docs_path
          : typeof entry.shell_docs_url === "string"
            ? entry.shell_docs_url
            : null;
      features[featureId] = {
        og_docs_url: og,
        shell_docs_path: shellPath,
      };
    }
    return { features };
  } catch (e) {
    errors.push(
      `${docsLinksPath}: failed to parse docs-links.json: ${(e as Error).message}`,
    );
    return { features: {} };
  }
}

function findManifestsIn(packagesDir: string): string[] {
  if (!fs.existsSync(packagesDir)) {
    return [];
  }

  const dirs = fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "agents")
    .map((d) => d.name);

  const manifests: string[] = [];
  for (const dir of dirs) {
    const manifestPath = path.join(packagesDir, dir, "manifest.yaml");
    if (fs.existsSync(manifestPath)) {
      manifests.push(manifestPath);
    }
  }
  return manifests;
}

function validateManifest(
  manifest: Record<string, unknown>,
  validate: ReturnType<Ajv["compile"]>,
  featureIds: Set<string>,
  filePath: string,
): string[] {
  const errors: string[] = [];

  if (!validate(manifest)) {
    for (const err of validate.errors || []) {
      errors.push(
        `${filePath}: Schema error at ${err.instancePath}: ${err.message}`,
      );
    }
  }

  // Validate feature IDs reference the registry
  const features = (manifest.features as string[]) || [];
  for (const featureId of features) {
    if (!featureIds.has(featureId)) {
      errors.push(
        `${filePath}: Unknown feature ID "${featureId}" not in feature registry`,
      );
    }
  }

  // Validate demo IDs reference declared features
  const demos = (manifest.demos as Array<{ id: string }>) || [];
  for (const demo of demos) {
    if (!featureIds.has(demo.id)) {
      errors.push(
        `${filePath}: Demo "${demo.id}" references unknown feature ID not in feature registry`,
      );
    }
  }

  // Validate not_supported_features doesn't overlap with features
  const notSupported = (manifest.not_supported_features as string[]) || [];
  for (const featureId of notSupported) {
    if (!featureIds.has(featureId)) {
      errors.push(
        `${filePath}: Unknown feature ID "${featureId}" in not_supported_features`,
      );
    }
    if (features.includes(featureId)) {
      errors.push(
        `${filePath}: Feature "${featureId}" appears in both features and not_supported_features — only one is allowed`,
      );
    }
  }

  return errors;
}

// --- Catalog types ---

interface CatalogCell {
  id: string;
  manifestation: "integrated" | "starter";
  integration: string;
  integration_name: string;
  feature: string | null;
  feature_name: string | null;
  category: string | null;
  category_name: string | null;
  status: "wired" | "stub" | "unshipped" | "unsupported";
  parity_tier: "reference" | "at_parity" | "partial" | "minimal" | "not_wired";
  max_depth: number;
}

interface CatalogMetadata {
  reference: string;
  total_cells: number;
  wired: number;
  stub: number;
  unshipped: number;
  unsupported: number;
  /** Cells for docs-only features — excluded from wired/stub/unshipped/unsupported. */
  docs_only: number;
  generated_at: string;
}

interface Catalog {
  metadata: CatalogMetadata;
  cells: CatalogCell[];
}

/**
 * Determine cell status for a (feature, integration) pair.
 *
 * - unsupported: feature is in manifest.not_supported_features (framework
 *   architecturally cannot support this feature). Checked first so this
 *   takes precedence over the wired/stub/unshipped fallthrough.
 * - wired: manifest declares the feature AND has a demo with a route for it
 * - stub: manifest declares the feature AND has a demo, but no route
 * - unshipped: feature is not in the manifest at all
 */
function determineCellStatus(
  featureId: string,
  manifest: Record<string, unknown>,
): "wired" | "stub" | "unshipped" | "unsupported" {
  const notSupported =
    (manifest.not_supported_features as string[] | undefined) || [];
  if (notSupported.includes(featureId)) {
    return "unsupported";
  }

  const features = (manifest.features as string[]) || [];
  if (!features.includes(featureId)) {
    return "unshipped";
  }

  const demos = (manifest.demos as Array<{ id: string; route?: string }>) || [];
  const demo = demos.find((d) => d.id === featureId);
  if (!demo) {
    // Feature declared but no demo entry at all
    return "unshipped";
  }

  if (demo.route) {
    return "wired";
  }

  // Demo exists but no route (e.g. cli-start with command: only)
  return "stub";
}

/**
 * Generate the full 663-cell catalog by cross-joining features x integrations,
 * plus 17 starter cells. Parity tiers are auto-derived from manifest data.
 */
function generateCatalog(
  featureRegistry: {
    features: Array<{
      id: string;
      name: string;
      category: string;
      kind?: string;
    }>;
    categories: Array<{ id: string; name: string }>;
  },
  integrations: Record<string, unknown>[],
): Catalog {
  // Build feature -> category lookup
  const featureCategoryMap = new Map<string, string>();
  for (const feature of featureRegistry.features) {
    featureCategoryMap.set(feature.id, feature.category);
  }

  // Build feature -> display name lookup
  const featureNameMap = new Map<string, string>();
  for (const feature of featureRegistry.features) {
    featureNameMap.set(feature.id, feature.name);
  }

  // Build category -> display name lookup
  const categoryNameMap = new Map<string, string>();
  for (const category of featureRegistry.categories) {
    categoryNameMap.set(category.id, category.name);
  }

  const allFeatureIds = featureRegistry.features.map((f) => f.id);

  // docs-only features (e.g. cli-start) exist for documentation coverage
  // tracking only — they have no route, no depth probes, and no health
  // signals. Exclude them from the wired/stub/unshipped/unsupported metadata
  // so the stats bar reflects only meaningful matrix cells.
  const docsOnlyFeatureIds = new Set(
    featureRegistry.features
      .filter((f) => f.kind === "docs-only")
      .map((f) => f.id),
  );

  // Step 1: Cross-join to produce integrated cells and collect wired features
  // and unsupported features per integration.
  const wiredFeaturesPerIntegration = new Map<string, Set<string>>();
  const unsupportedFeaturesPerIntegration = new Map<string, Set<string>>();
  const cells: CatalogCell[] = [];

  for (const integration of integrations) {
    const slug = integration.slug as string;
    const integrationName = integration.name as string;
    const wiredFeatures = new Set<string>();
    const unsupportedFeatures = new Set<string>();

    for (const featureId of allFeatureIds) {
      const status = determineCellStatus(featureId, integration);
      if (status === "wired") {
        wiredFeatures.add(featureId);
      }
      if (status === "unsupported") {
        unsupportedFeatures.add(featureId);
      }

      const categoryId = featureCategoryMap.get(featureId) || null;

      // Unsupported and unshipped cells share max_depth=0 — neither has any
      // probes to regress against. They differ only in *intent*: unsupported
      // is a hard architectural floor, unshipped is just unbuilt.
      const maxDepth =
        status === "unshipped" || status === "unsupported" ? 0 : 4;

      cells.push({
        id: `${slug}/${featureId}`,
        manifestation: "integrated",
        integration: slug,
        integration_name: integrationName,
        feature: featureId,
        feature_name: featureNameMap.get(featureId) || null,
        category: categoryId,
        category_name: categoryId
          ? categoryNameMap.get(categoryId) || null
          : null,
        status,
        parity_tier: "not_wired", // placeholder, computed below
        max_depth: maxDepth,
      });
    }

    wiredFeaturesPerIntegration.set(slug, wiredFeatures);
    unsupportedFeaturesPerIntegration.set(slug, unsupportedFeatures);
  }

  // Step 2: Reference integration — always langgraph-python.
  const referenceSlug = "langgraph-python";

  const referenceWiredFeatures =
    wiredFeaturesPerIntegration.get(referenceSlug)!;
  console.log(
    `\nCatalog: reference integration = ${referenceSlug} (${referenceWiredFeatures.size} wired features)`,
  );

  // Step 3: Compute parity tiers for each integration
  const integrationTiers = new Map<
    string,
    "reference" | "at_parity" | "partial" | "minimal" | "not_wired"
  >();

  for (const [slug, wiredSet] of wiredFeaturesPerIntegration) {
    if (slug === referenceSlug) {
      integrationTiers.set(slug, "reference");
      continue;
    }

    // Parity is computed against the *expected* feature set for this
    // integration: reference features minus features this integration's
    // framework architecturally cannot support. A framework that legitimately
    // can't support a feature should not be penalised for the gap.
    const unsupportedSet =
      unsupportedFeaturesPerIntegration.get(slug) ?? new Set<string>();
    const expectedFromReference = [...referenceWiredFeatures].filter(
      (f) => !unsupportedSet.has(f),
    );

    // Check if this integration's wired features cover everything in
    // expectedFromReference (i.e., it has parity over the supportable subset).
    const isSuperset = expectedFromReference.every((f) => wiredSet.has(f));
    if (isSuperset) {
      integrationTiers.set(slug, "at_parity");
      continue;
    }

    // Count intersection with the expected (supportable) reference features.
    const intersectionSize = expectedFromReference.filter((f) =>
      wiredSet.has(f),
    ).length;
    if (intersectionSize >= 3) {
      integrationTiers.set(slug, "partial");
    } else if (intersectionSize >= 1) {
      integrationTiers.set(slug, "minimal");
    } else {
      integrationTiers.set(slug, "not_wired");
    }
  }

  // Step 4: Apply parity tiers to all integrated cells
  for (const cell of cells) {
    if (cell.manifestation === "integrated") {
      cell.parity_tier = integrationTiers.get(cell.integration)!;
    }
  }

  // Step 5: Add 17 starter cells
  for (const integration of integrations) {
    const slug = integration.slug as string;
    const integrationName = integration.name as string;
    const starter = integration.starter as Record<string, unknown> | undefined;
    if (starter) {
      cells.push({
        id: `starter/${slug}`,
        manifestation: "starter",
        integration: slug,
        integration_name: integrationName,
        feature: null,
        feature_name: null,
        category: null,
        category_name: null,
        status: "wired",
        parity_tier: integrationTiers.get(slug) || "not_wired",
        max_depth: 4,
      });
    }
  }

  // Step 6: Compute metadata
  // Exclude docs-only cells from the headline counts — they are purely
  // informational and don't participate in depth, health, or coverage.
  const countableCells = cells.filter(
    (c) => c.feature === null || !docsOnlyFeatureIds.has(c.feature),
  );
  const docsOnlyCount = cells.length - countableCells.length;
  const wiredCount = countableCells.filter((c) => c.status === "wired").length;
  const stubCount = countableCells.filter((c) => c.status === "stub").length;
  const unshippedCount = countableCells.filter(
    (c) => c.status === "unshipped",
  ).length;
  const unsupportedCount = countableCells.filter(
    (c) => c.status === "unsupported",
  ).length;

  const metadata: CatalogMetadata = {
    reference: referenceSlug,
    total_cells: countableCells.length,
    wired: wiredCount,
    stub: stubCount,
    unshipped: unshippedCount,
    unsupported: unsupportedCount,
    docs_only: docsOnlyCount,
    generated_at: new Date().toISOString(),
  };

  return {
    metadata,
    cells,
  };
}

// ---------------------------------------------------------------------------
// New-shape (agents/<fw>/manifest.yaml) ingestion
// ---------------------------------------------------------------------------

/**
 * Load the nextjs/demos.yaml catalog and return a Map keyed by demo id.
 * Returns an empty Map if the file doesn't exist.
 */
function loadDemoCatalogMap(
  integrationsRoot: string,
): Map<string, { name: string; description: string; tags: string[] }> {
  const demosPath = path.join(integrationsRoot, "nextjs", "demos.yaml");
  if (!fs.existsSync(demosPath)) return new Map();
  const parsed = parseDemoCatalog(fs.readFileSync(demosPath, "utf-8"));
  if (parsed.kind !== "ok")
    throw new Error(`nextjs/demos.yaml malformed: ${parsed.reason}`);
  return new Map(parsed.entries.map((e) => [e.id, e] as const));
}

/**
 * Scan agents/<fw>/manifest.yaml files and produce Integration records
 * using the new-shape parser. New-shape integrations get:
 *   - unified: true
 *   - backend_url: the unified frontend URL
 *   - agent_backend_url: the original backend_url from the manifest
 *   - demos synthesized with routes /demos/<slug>/<demo-id>
 */
function loadNewShapeIntegrations(
  integrationsRoot: string,
  unifiedUrl: string,
): Record<string, unknown>[] {
  const agentsDir = path.join(integrationsRoot, "agents");
  if (!fs.existsSync(agentsDir)) return [];
  const catalog = loadDemoCatalogMap(integrationsRoot);
  const out: Record<string, unknown>[] = [];
  for (const slug of fs.readdirSync(agentsDir)) {
    const fwRoot = path.join(agentsDir, slug);
    if (!fs.statSync(fwRoot).isDirectory()) continue;
    const manifestPath = path.join(fwRoot, "manifest.yaml");
    if (!fs.existsSync(manifestPath)) continue;
    const parsed = parseManifestV2(fs.readFileSync(manifestPath, "utf-8"));
    if (parsed.kind !== "ok")
      throw new Error(`agents/${slug}/manifest.yaml malformed: ${parsed.reason}`);
    const m = parsed.manifest;
    const demos = m.demos.map((d) => {
      const cat = catalog.get(d.id);
      return {
        id: d.id,
        name: cat?.name ?? d.id,
        description: cat?.description ?? "",
        tags: cat?.tags ?? [],
        route: `/demos/${m.slug}/${d.id}`,
      };
    });
    out.push({
      name: m.name,
      slug: m.slug,
      category: m.category ?? "emerging",
      language: m.language,
      logo: m.logo ?? "",
      description: m.description,
      repo: m.repo ?? "",
      backend_url: unifiedUrl,
      agent_backend_url: m.backend_url,
      deployed: m.deployed,
      sort_order: m.sort_order,
      features: demos.map((d) => d.id),
      demos,
      not_supported_features: [],
      unified: true,
    });
    console.log(`  OK (new-shape): ${m.name} (${m.slug})`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Exported runner (called by main() and by tests with fixture directories)
// ---------------------------------------------------------------------------

export interface RunGeneratorOptions {
  /** Override the integrations root directory (default: showcase/integrations). */
  integrationsRoot?: string;
  /** Override the unified frontend URL (default: SHOWCASE_INTEGRATIONS_NEXTJS_URL env or hardcoded default). */
  unifiedFrontendUrl?: string;
  /** When true, skip writing output files (useful for tests that only care about the registry data). */
  dryRun?: boolean;
}

/**
 * Core registry-generation logic. Extracted from `main()` so tests can call
 * it directly with fixture directories instead of spawning a subprocess.
 *
 * Returns the generated registry object (useful for test assertions).
 * In non-dry-run mode, also writes registry.json / catalog.json to OUTPUT_DIRS.
 */
export function runGenerator(options: RunGeneratorOptions = {}): {
  feature_registry: unknown;
  integrations: Record<string, unknown>[];
  packages: Array<{ slug: string; name: string }>;
} {
  const integrationsRoot = options.integrationsRoot ?? PACKAGES_DIR;
  const unifiedUrl = options.unifiedFrontendUrl ?? UNIFIED_FRONTEND_URL;
  const isDryRun = options.dryRun ?? false;

  const schema = loadSchema();
  const featureRegistry = loadFeatureRegistry();
  const featureIds = new Set<string>(
    featureRegistry.features.map((f: { id: string }) => f.id),
  );

  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  // --- Old-shape manifests: integrations/<fw>/manifest.yaml ---
  const oldShapeManifestPaths = findManifestsIn(integrationsRoot);

  if (oldShapeManifestPaths.length === 0 && !fs.existsSync(path.join(integrationsRoot, "agents"))) {
    console.log("No integration packages found. Generating empty registry.");
  }

  const oldShapeIntegrations: Record<string, unknown>[] = [];
  const allErrors: string[] = [];

  for (const manifestPath of oldShapeManifestPaths) {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    let manifest: Record<string, unknown>;

    try {
      manifest = yaml.parse(raw);
    } catch (e) {
      allErrors.push(`${manifestPath}: Failed to parse YAML: ${e}`);
      continue;
    }

    const errors = validateManifest(manifest, validate, featureIds, manifestPath);
    if (errors.length > 0) {
      allErrors.push(...errors);
      continue;
    }

    oldShapeIntegrations.push(manifest);
    console.log(`  OK: ${manifest.name} (${manifest.slug})`);
  }

  // Merge per-package docs-links.json overrides
  for (const manifest of oldShapeIntegrations) {
    const pkgDir = path.join(integrationsRoot, manifest.slug as string);
    manifest.docs_links = loadDocsLinks(pkgDir, allErrors);
  }

  // Constraint validation (old-shape only)
  const constraintsRaw = fs.readFileSync(CONSTRAINTS_PATH, "utf-8");
  const constraints = yaml.parse(constraintsRaw);

  for (const manifest of oldShapeIntegrations) {
    const constraintErrors = validateManifestConstraints(
      manifest as {
        slug: string;
        generative_ui?: string[];
        interaction_modalities?: string[];
        demos: Array<{ id: string; name: string }>;
      },
      constraints,
    );
    if (constraintErrors.length > 0) {
      allErrors.push(...constraintErrors);
    }
  }

  if (allErrors.length > 0) {
    const message = allErrors.map((e) => `  ERROR: ${e}`).join("\n");
    throw new Error(`\nValidation errors:\n${message}`);
  }

  // --- New-shape manifests: agents/<fw>/manifest.yaml ---
  const newShapeIntegrations = loadNewShapeIntegrations(integrationsRoot, unifiedUrl);

  // --- Merge: new-shape wins per slug ---
  const bySlug = new Map<string, Record<string, unknown>>();
  for (const i of oldShapeIntegrations) bySlug.set(i.slug as string, i);
  for (const i of newShapeIntegrations) bySlug.set(i.slug as string, i);
  const integrations = Array.from(bySlug.values());

  // Sort by sort_order (lower = higher priority), then name as tiebreaker
  integrations.sort((a, b) => {
    const orderA = (a.sort_order as number) ?? 999;
    const orderB = (b.sort_order as number) ?? 999;
    if (orderA !== orderB) return orderA - orderB;
    return String(a.name).localeCompare(String(b.name));
  });

  // Load packages list from shared/packages.json
  let packages: Array<{ slug: string; name: string }> = [];
  if (fs.existsSync(PACKAGES_JSON_PATH)) {
    const packagesRaw = fs.readFileSync(PACKAGES_JSON_PATH, "utf-8");
    packages = JSON.parse(packagesRaw);
    console.log(`\nLoaded ${packages.length} packages from packages.json`);
  }

  const registry = {
    feature_registry: featureRegistry,
    integrations,
    packages,
  };

  if (!isDryRun) {
    const registryJson = JSON.stringify(registry, null, 2) + "\n";
    for (const dir of OUTPUT_DIRS) {
      fs.mkdirSync(dir, { recursive: true });
      const outputPath = path.join(dir, "registry.json");
      fs.writeFileSync(outputPath, registryJson);
      console.log(
        `\nRegistry generated: ${outputPath} (${integrations.length} integrations)`,
      );
    }

    // Write constraints.json for the shell's client-side filtering
    fs.writeFileSync(
      CONSTRAINTS_OUTPUT_PATH,
      JSON.stringify(constraints, null, 2) + "\n",
    );
    console.log(`Constraints written: ${CONSTRAINTS_OUTPUT_PATH}`);

    // --- Catalog generation (D0-D4 dashboard matrix) ---
    const catalog = generateCatalog(featureRegistry, integrations);
    const catalogJson = JSON.stringify(catalog, null, 2) + "\n";
    for (const dir of OUTPUT_DIRS) {
      const catalogPath = path.join(dir, "catalog.json");
      fs.writeFileSync(catalogPath, catalogJson);
      console.log(
        `Catalog generated: ${catalogPath} (${catalog.metadata.total_cells} cells)`,
      );
    }
  }

  return registry;
}

function main() {
  console.log("Generating integration registry...\n");
  try {
    runGenerator();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

// Guard: only run main() when this file is invoked directly (not when imported
// by tests or other modules). Matches the pattern used by validate-constraints.ts,
// deploy-to-railway.ts, and other scripts in this directory.
if (process.argv[1] === __filename) {
  main();
}
