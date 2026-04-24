// Registry Generator
//
// Scans showcase/packages/*/manifest.yaml, validates each against the
// manifest JSON schema, and produces showcase/shell/src/data/registry.json.
//
// Usage: npx tsx showcase/scripts/generate-registry.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { validateManifestConstraints } from "./validate-constraints.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const PACKAGES_DIR = path.join(ROOT, "packages");
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

function findManifests(): string[] {
  if (!fs.existsSync(PACKAGES_DIR)) {
    return [];
  }

  const dirs = fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const manifests: string[] = [];
  for (const dir of dirs) {
    const manifestPath = path.join(PACKAGES_DIR, dir, "manifest.yaml");
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
  status: "wired" | "stub" | "unshipped";
  parity_tier: "reference" | "at_parity" | "partial" | "minimal" | "not_wired";
  max_depth: number;
}

interface CatalogMetadata {
  reference: string;
  total_cells: number;
  wired: number;
  stub: number;
  unshipped: number;
  generated_at: string;
}

interface Catalog {
  metadata: CatalogMetadata;
  cells: CatalogCell[];
}

/**
 * Determine cell status for a (feature, integration) pair.
 *
 * - wired: manifest declares the feature AND has a demo with a route for it
 * - stub: manifest declares the feature AND has a demo, but no route
 * - unshipped: feature is not in the manifest at all
 */
function determineCellStatus(
  featureId: string,
  manifest: Record<string, unknown>,
): "wired" | "stub" | "unshipped" {
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
  featureRegistry: { features: Array<{ id: string; name: string; category: string }>; categories: Array<{ id: string; name: string }> },
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

  // Step 1: Cross-join to produce integrated cells and collect wired features per integration
  const wiredFeaturesPerIntegration = new Map<string, Set<string>>();
  const cells: CatalogCell[] = [];

  for (const integration of integrations) {
    const slug = integration.slug as string;
    const integrationName = integration.name as string;
    const wiredFeatures = new Set<string>();

    for (const featureId of allFeatureIds) {
      const status = determineCellStatus(featureId, integration);
      if (status === "wired") {
        wiredFeatures.add(featureId);
      }

      const categoryId = featureCategoryMap.get(featureId) || null;

      cells.push({
        id: `${slug}/${featureId}`,
        manifestation: "integrated",
        integration: slug,
        integration_name: integrationName,
        feature: featureId,
        feature_name: featureNameMap.get(featureId) || null,
        category: categoryId,
        category_name: categoryId ? (categoryNameMap.get(categoryId) || null) : null,
        status,
        parity_tier: "not_wired", // placeholder, computed below
        max_depth: status === "unshipped" ? 0 : 4,
      });
    }

    wiredFeaturesPerIntegration.set(slug, wiredFeatures);
  }

  // Step 2: Auto-detect reference integration (most wired features, ties broken alphabetically)
  let referenceSlug = "";
  let referenceCount = -1;
  for (const [slug, wiredSet] of wiredFeaturesPerIntegration) {
    const count = wiredSet.size;
    if (count > referenceCount || (count === referenceCount && slug < referenceSlug)) {
      referenceSlug = slug;
      referenceCount = count;
    }
  }

  const referenceWiredFeatures = wiredFeaturesPerIntegration.get(referenceSlug)!;
  console.log(`\nCatalog: reference integration = ${referenceSlug} (${referenceCount} wired features)`);

  // Step 3: Compute parity tiers for each integration
  const integrationTiers = new Map<string, "reference" | "at_parity" | "partial" | "minimal" | "not_wired">();

  for (const [slug, wiredSet] of wiredFeaturesPerIntegration) {
    if (slug === referenceSlug) {
      integrationTiers.set(slug, "reference");
      continue;
    }

    // Check if this integration's wired features are a superset of the reference's
    const isSuperset = [...referenceWiredFeatures].every((f) => wiredSet.has(f));
    if (isSuperset) {
      integrationTiers.set(slug, "at_parity");
      continue;
    }

    // Count intersection with reference's wired features
    const intersectionSize = [...referenceWiredFeatures].filter((f) => wiredSet.has(f)).length;
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
  const wiredCount = cells.filter((c) => c.status === "wired").length;
  const stubCount = cells.filter((c) => c.status === "stub").length;
  const unshippedCount = cells.filter((c) => c.status === "unshipped").length;

  const metadata: CatalogMetadata = {
    reference: referenceSlug,
    total_cells: cells.length,
    wired: wiredCount,
    stub: stubCount,
    unshipped: unshippedCount,
    generated_at: new Date().toISOString(),
  };

  return {
    metadata,
    cells,
  };
}

function main() {
  console.log("Generating integration registry...\n");

  const schema = loadSchema();
  const featureRegistry = loadFeatureRegistry();
  const featureIds = new Set<string>(
    featureRegistry.features.map((f: { id: string }) => f.id),
  );

  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const manifestPaths = findManifests();

  if (manifestPaths.length === 0) {
    console.log("No integration packages found. Generating empty registry.");
  }

  const integrations: Record<string, unknown>[] = [];
  const allErrors: string[] = [];

  for (const manifestPath of manifestPaths) {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    let manifest: Record<string, unknown>;

    try {
      manifest = yaml.parse(raw);
    } catch (e) {
      allErrors.push(`${manifestPath}: Failed to parse YAML: ${e}`);
      continue;
    }

    const errors = validateManifest(
      manifest,
      validate,
      featureIds,
      manifestPath,
    );
    if (errors.length > 0) {
      allErrors.push(...errors);
      continue;
    }

    integrations.push(manifest);
    console.log(`  OK: ${manifest.name} (${manifest.slug})`);
  }

  // Merge per-package docs-links.json overrides onto each integration *after*
  // schema validation, since `docs_links` isn't part of the manifest schema.
  // Best-effort: missing file or stale shapes are tolerated and don't error.
  for (const manifest of integrations) {
    const pkgDir = path.join(PACKAGES_DIR, manifest.slug as string);
    manifest.docs_links = loadDocsLinks(pkgDir, allErrors);
  }

  // Constraint validation
  const constraintsRaw = fs.readFileSync(CONSTRAINTS_PATH, "utf-8");
  const constraints = yaml.parse(constraintsRaw);

  for (const manifest of integrations) {
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
    console.error("\nValidation errors:");
    for (const err of allErrors) {
      console.error(`  ERROR: ${err}`);
    }
    process.exit(1);
  }

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
    console.log(`Catalog generated: ${catalogPath} (${catalog.metadata.total_cells} cells)`);
  }
}

main();
