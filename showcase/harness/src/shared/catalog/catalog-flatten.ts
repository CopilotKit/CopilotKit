/**
 * The SINGLE catalog-flattening authority (finding 1).
 *
 * `generateCatalog` cross-joins `shared/feature-registry.json`'s features
 * against every integration manifest to produce the `CatalogCell[]` grid the
 * dashboard renders. It historically lived — module-private — inside
 * `showcase/scripts/generate-registry.ts`, so the ONLY way to get the cell grid
 * server-side was to import the dashboard's generated `catalog.json` (a
 * gitignored, cross-package build artifact) or to re-implement the flatten (and
 * risk drift). This module is that flatten, factored out so BOTH consume the
 * ONE implementation:
 *   - `showcase/scripts/generate-registry.ts` (the build-time codegen that
 *     writes `catalog.json`) imports `generateCatalog` from here; and
 *   - the harness `GET /api/matrix` read-model (`http/matrix.ts`, T13) calls
 *     `buildCatalogCells()` here to enumerate cells server-side.
 *
 * It lives in the harness (not in `scripts/`) because the harness build
 * (`tsc -p tsconfig.build.json`, `rootDir: src`) cannot import a file outside
 * `src/`, whereas the codegen script runs under `tsx` (no emit, no rootDir) and
 * imports across packages freely — the established direction (cf.
 * `scripts/equivalence-gate.ts` importing `shell-dashboard/src`).
 *
 * The pure flatten (`generateCatalog` / `determineCellStatus`) is
 * side-effect-free over its inputs: it never touches `console` or
 * `process.exit`. It signals a fatal input (a non-empty integration set with
 * the reference integration absent) ONLY by THROWING a typed
 * `MissingReferenceIntegrationError`. This matters because the flatten is
 * dual-used: the build-time codegen (`generate-registry.ts`, under `tsx`)
 * catches the throw and applies its CLI error contract (labeled stderr +
 * `process.exit(1)`), while the LIVE harness `GET /api/matrix` route lets its
 * own try/catch convert the throw into an HTTP-200 `matrix_unavailable`
 * degraded response. A `process.exit` here would be UNCATCHABLE and hard-kill
 * the whole harness process on a single request (bypassing the route's
 * defense), so the shared path must never call it.
 *
 * The loaders (`loadFeatureRegistry` / `findManifests` /
 * `loadIntegrationManifests` / `buildCatalogCells`) read the committed sources
 * from disk and are used only by the server-side re-flatten. A malformed
 * manifest surfaces as a thrown `ManifestParseError` (never silently dropped)
 * so a broken/partial deploy degrades loudly rather than silently omitting a
 * reference integration.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

/**
 * The reference integration is absent from a non-empty integration set, so
 * every parity tier (all computed against it) is meaningless. Thrown — never
 * `process.exit`ed — so BOTH consumers of the shared flatten can react
 * appropriately (CLI → stderr + exit 1; live route → `matrix_unavailable`).
 */
export class MissingReferenceIntegrationError extends Error {
  constructor(
    public readonly referenceSlug: string,
    public readonly presentSlugs: string[],
  ) {
    super(
      `reference integration "${referenceSlug}" is missing from the ` +
        `validated integrations (${presentSlugs.join(", ")}) — parity tiers ` +
        `cannot be computed. Restore integrations/${referenceSlug}/manifest.yaml ` +
        `(or fix its validation errors).`,
    );
    this.name = "MissingReferenceIntegrationError";
  }
}

/**
 * An integration manifest on disk could not be parsed. Thrown (never silently
 * skipped) so a corrupt/partial deploy surfaces loudly — a silently dropped
 * manifest can remove the reference integration and cascade into a misleading
 * `MissingReferenceIntegrationError`.
 */
export class ManifestParseError extends Error {
  constructor(
    public readonly manifestPath: string,
    public readonly parseCause: unknown,
  ) {
    super(
      `failed to parse integration manifest ${manifestPath}: ` +
        `${parseCause instanceof Error ? parseCause.message : String(parseCause)}`,
    );
    this.name = "ManifestParseError";
  }
}

/**
 * A raw manifest parsed cleanly as a YAML mapping but is STRUCTURALLY invalid
 * for flattening (e.g. no `slug`, a `slug` that fails the schema pattern, a
 * `features` list that is not an array of strings, or a `features` /
 * `not_supported_features` overlap). Thrown so the harness re-flatten degrades
 * loudly rather than emitting `undefined`-keyed garbage cells / parity-shifted
 * verdicts (see `validateManifestStructure`). The route's try/catch converts
 * this into `matrix_unavailable`.
 */
export class ManifestValidationError extends Error {
  constructor(
    public readonly manifestPath: string,
    public readonly reasons: string[],
  ) {
    super(
      `integration manifest ${manifestPath} is structurally invalid: ` +
        reasons.join("; "),
    );
    this.name = "ManifestValidationError";
  }
}

/**
 * URL-safe slug pattern — mirrors `shared/manifest.schema.json`'s `slug`
 * pattern so the harness re-flatten enforces the SAME slug contract the CLI
 * codegen's AJV validation does.
 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

/**
 * A structural guard for a raw manifest on the harness re-flatten path, at
 * parity with the codegen's schema validation for the fields `generateCatalog`
 * consumes. The CLI codegen runs full AJV validation and `process.exit(1)`s
 * before flattening, so `catalog.json` never contains cells from an invalid
 * manifest; this guard gives the live `/api/matrix` re-flatten the same
 * protection (finding: server re-flatten enumerated cells from UNVALIDATED
 * manifests). It validates ONLY the fields that flatten into cells / shift
 * parity tiers — a slug-less or malformed manifest would otherwise emit
 * `undefined`-keyed cells or corrupt parity. Returns the reasons a manifest is
 * invalid (empty ⇒ valid); the loader throws `ManifestValidationError` on a
 * non-empty result.
 */
export function validateManifestStructure(
  manifest: Record<string, unknown>,
): string[] {
  const reasons: string[] = [];

  const slug = manifest.slug;
  if (typeof slug !== "string" || slug.length === 0) {
    reasons.push("missing or non-string `slug`");
  } else if (!SLUG_PATTERN.test(slug)) {
    reasons.push(`\`slug\` "${slug}" does not match ${SLUG_PATTERN.source}`);
  }

  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    reasons.push("missing or non-string `name`");
  }

  const isStringArray = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === "string");

  const {
    features,
    not_supported_features: notSupported,
    demos,
    starter,
  } = manifest;

  if (features !== undefined && !isStringArray(features)) {
    reasons.push("`features` must be an array of strings");
  }
  if (notSupported !== undefined && !isStringArray(notSupported)) {
    reasons.push("`not_supported_features` must be an array of strings");
  }
  // A feature declared BOTH supported and not-supported is contradictory and
  // shifts the parity tier (the expected-subset filter drops it from the
  // reference set) — reject it rather than silently mis-tier the column.
  if (isStringArray(features) && isStringArray(notSupported)) {
    const overlap = features.filter((f) => notSupported.includes(f));
    if (overlap.length > 0) {
      reasons.push(
        `\`features\` and \`not_supported_features\` overlap: ${overlap.join(", ")}`,
      );
    }
  }
  if (demos !== undefined && !Array.isArray(demos)) {
    reasons.push("`demos` must be an array");
  }
  if (
    starter !== undefined &&
    (starter === null || typeof starter !== "object" || Array.isArray(starter))
  ) {
    reasons.push("`starter` must be a mapping");
  }

  return reasons;
}

export interface CatalogCell {
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

export interface CatalogMetadata {
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

export interface Catalog {
  metadata: CatalogMetadata;
  cells: CatalogCell[];
}

/**
 * Feature-registry shape `generateCatalog` reads. Kept structural so both the
 * codegen's parsed JSON and the harness loader satisfy it.
 */
export interface FeatureRegistry {
  features: Array<{
    id: string;
    name: string;
    category: string;
    kind?: string;
    deprecated?: boolean;
  }>;
  categories: Array<{ id: string; name: string }>;
}

/**
 * Determine cell status for a (feature, integration) pair.
 *
 * - unsupported: feature is in manifest.not_supported_features (framework
 *   architecturally cannot support this feature). Checked first so this
 *   takes precedence over the wired/stub/unshipped fallthrough.
 * - wired: manifest declares the feature AND has a demo with a route for it
 * - stub: manifest declares the feature AND has a demo, but no route
 * - unshipped: feature is not in the manifest at all, OR is declared in
 *   `features` without any matching demo entry
 */
export function determineCellStatus(
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
 * Generate the full catalog by cross-joining features x integrations
 * (features.length × integrations.length integrated cells), plus one
 * starter cell per integration that declares a `starter` block. Parity
 * tiers are auto-derived from manifest data.
 */
export function generateCatalog(
  featureRegistry: FeatureRegistry,
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

  // Deprecated features — consolidated/replaced patterns that LGP (the
  // gold-standard reference integration) intentionally does NOT implement,
  // but legacy integrations still serve. The catalog emits cells for all
  // (integration × feature) pairs uniformly; visibility is controlled at
  // the dashboard layer via a "Show deprecated" toggle that filters whole
  // FEATURE ROWS based on `feature.deprecated`. That way toggle-on
  // surfaces both the audit trail (integrations that declare these
  // legacy patterns) and the empty cells (LGP shows N/A for them) in one
  // pass without missing-data artifacts.

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

  const referenceWiredFeatures = wiredFeaturesPerIntegration.get(referenceSlug);
  if (referenceWiredFeatures === undefined) {
    if (integrations.length === 0) {
      // The zero-manifests "empty registry" path is supported — main()
      // logs "No integration packages found." and continues — so the
      // catalog must short-circuit cleanly instead of crashing on the
      // absent reference (SU7-F3). No `console.*` here: the flatten is a
      // pure function shared with the live server; the CLI caller owns any
      // logging.
      return {
        metadata: {
          reference: referenceSlug,
          total_cells: 0,
          wired: 0,
          stub: 0,
          unshipped: 0,
          unsupported: 0,
          docs_only: 0,
          generated_at: new Date().toISOString(),
        },
        cells: [],
      };
    }
    // Integrations exist but the reference is absent: every parity tier is
    // computed against it, so the catalog is meaningless. THROW (never
    // `process.exit`) — the shared flatten is reachable from the live
    // `/api/matrix` handler, where `process.exit` would be uncatchable and
    // hard-kill the harness. The build-time CLI (`generate-registry.ts`)
    // catches this and applies its labeled-stderr + exit(1) contract; the
    // server route's try/catch converts it into `matrix_unavailable`.
    throw new MissingReferenceIntegrationError(
      referenceSlug,
      integrations.map((i) => i.slug as string),
    );
  }

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

  // Step 5: Add one starter cell per integration that declares a
  // `starter` block
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
// Server-side loaders (harness re-flatten path — T13)
// ---------------------------------------------------------------------------

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * The `showcase/` root. Resolves 4 levels up from this module
 * (`harness/{src,dist}/shared/catalog/`), so it is correct whether running
 * from TS source (tsx/vitest) or the compiled `dist/`. Overridable via
 * `SHOWCASE_ROOT` for deployments that stage the committed sources elsewhere.
 */
export const SHOWCASE_ROOT =
  process.env.SHOWCASE_ROOT ?? path.resolve(MODULE_DIR, "../../../..");

/** Read + parse the committed `shared/feature-registry.json`. */
export function loadFeatureRegistry(
  root: string = SHOWCASE_ROOT,
): FeatureRegistry {
  const raw = fs.readFileSync(
    path.join(root, "shared", "feature-registry.json"),
    "utf-8",
  );
  return JSON.parse(raw) as FeatureRegistry;
}

/** Absolute paths of every `integrations/<slug>/manifest.yaml`. */
export function findManifests(root: string = SHOWCASE_ROOT): string[] {
  const packagesDir = path.join(root, "integrations");
  if (!fs.existsSync(packagesDir)) {
    return [];
  }
  const dirs = fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
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

/**
 * Parse every integration manifest from disk into a raw manifest object.
 *
 * `generateCatalog`/`determineCellStatus` read only raw manifest fields
 * (`slug`/`name`/`features`/`not_supported_features`/`demos`/`starter`), none
 * of which the codegen's full validation+`backend_url`/`docs_links` rebuild
 * synthesizes — so the server-side re-flatten needs neither schema validation
 * nor the rebuild the codegen layers on for the emitted `registry.json`.
 *
 * A YAML-parse failure THROWS `ManifestParseError` rather than being skipped:
 * silently dropping a manifest can remove the reference integration and
 * cascade into a misleading `MissingReferenceIntegrationError` (or a silently
 * wrong grid). The route's try/catch turns the throw into `matrix_unavailable`
 * — a loud, correct degradation. Non-mapping parse RESULTS (a YAML doc that is
 * valid but not an object, e.g. a bare scalar/list) are still skipped: they
 * contribute no cells and are not a parse failure.
 */
export function loadIntegrationManifests(
  root: string = SHOWCASE_ROOT,
): Record<string, unknown>[] {
  const integrations: Record<string, unknown>[] = [];
  for (const manifestPath of findManifests(root)) {
    let manifest: unknown;
    try {
      manifest = yaml.load(fs.readFileSync(manifestPath, "utf-8"));
    } catch (err) {
      throw new ManifestParseError(manifestPath, err);
    }
    if (
      manifest === null ||
      manifest === undefined ||
      typeof manifest !== "object" ||
      Array.isArray(manifest)
    ) {
      continue;
    }
    // Structural validation at parity with the codegen's AJV pass: a YAML-valid
    // but schema-invalid manifest (no `slug`, bad `slug`, malformed `features`)
    // would flatten into `undefined`-keyed garbage cells / parity-shifted
    // verdicts, diverging from the dashboard's validated `catalog.json`. THROW
    // (never silently include/skip) so the route degrades to
    // `matrix_unavailable` — the same loud degradation as a parse failure.
    const reasons = validateManifestStructure(
      manifest as Record<string, unknown>,
    );
    if (reasons.length > 0) {
      throw new ManifestValidationError(manifestPath, reasons);
    }
    integrations.push(manifest as Record<string, unknown>);
  }
  return integrations;
}

/**
 * Re-flatten the static catalog cell grid directly from the committed
 * `shared/feature-registry.json` + per-integration manifests — the SINGLE
 * flattening authority (finding 1). The harness `/api/matrix` route (T13) uses
 * this so it never imports the dashboard's generated, gitignored `catalog.json`
 * (which would re-introduce a cross-package/build-order dependency).
 */
export function buildCatalogCells(root: string = SHOWCASE_ROOT): CatalogCell[] {
  return generateCatalog(
    loadFeatureRegistry(root),
    loadIntegrationManifests(root),
  ).cells;
}
