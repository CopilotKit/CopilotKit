// Registry Generator
//
// Scans showcase/integrations/*/manifest.yaml, validates each against the
// manifest JSON schema, and produces showcase/shell/src/data/registry.json.
//
// Usage: npx tsx showcase/scripts/generate-registry.ts

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { validateManifestConstraints } from "./validate-constraints.js";
// The catalog flatten (cross-join + parity tiers) is the SINGLE flattening
// authority (finding 1), factored into the harness so BOTH this codegen and the
// harness `GET /api/matrix` read-model (T13) call the ONE implementation. It
// lives in the harness because the harness build (rootDir: src) cannot import a
// file outside src/, whereas this script runs under tsx (no emit) and imports
// across packages freely — cf. scripts/equivalence-gate.ts.
import {
  generateCatalog,
  MissingReferenceIntegrationError,
} from "../harness/src/shared/catalog/catalog-flatten.js";
import { normalizeFrontendRegistry } from "./lib/frontend-registry.js";
import { generateFrontendCatalog } from "./lib/frontend-catalog.js";

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
const FRONTEND_REGISTRY_PATH = path.join(
  ROOT,
  "shared",
  "frontend-registry.json",
);

// Backend host pattern — used to synthesize `backend_url` for every
// manifest. `{slug}` is the only placeholder. Manifests no longer ship
// `backend_url` (PR2 stripped them all), so this synthesis IS the source
// of truth; a manifest-supplied value is still honored in the dual-read
// below for safety/backporting. The default reproduces the Railway
// hostname convention, and CI/tests can point a single deployed image at
// a different env by overriding this var — same env var and semantics as
// the runtime consumer (shell/src/lib/backend-url.ts).
const DEFAULT_BACKEND_HOST_PATTERN =
  "showcase-{slug}-production.up.railway.app";

// Env resolution parity with the runtime consumer (readEnvPair in
// shell/src/lib/runtime-config.ts): values are trimmed, an empty or
// whitespace-only primary counts as unset, and the NEXT_PUBLIC_-prefixed
// alternate is honored before the default (SU7-F3).
function readBackendHostPatternEnv(): string | undefined {
  for (const key of [
    "SHOWCASE_BACKEND_HOST_PATTERN",
    "NEXT_PUBLIC_SHOWCASE_BACKEND_HOST_PATTERN",
  ]) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

// Matches an explicit URL scheme prefix — local copy of SCHEME_RE from
// shell/src/lib/backend-url.ts (scripts cannot import shell src).
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Can the normalized pattern actually form a backend URL? Probe by
 * substituting a registry-shaped slug and parsing the consumer's exact
 * composition (`https://` + pattern) — same gate as the runtime's
 * isUsablePattern/patternForbiddenComponent pair: empty results,
 * internal whitespace, anything `new URL` rejects, and forbidden
 * components (userinfo/query/fragment) all fail.
 */
function isUsableBackendHostPattern(normalized: string): boolean {
  if (normalized.length === 0) return false;
  try {
    const probe = new URL(
      `https://${normalized.replaceAll("{slug}", "probe")}`,
    );
    return (
      probe.hostname.length > 0 &&
      !/^https?$/i.test(probe.hostname) &&
      probe.username === "" &&
      probe.password === "" &&
      probe.search === "" &&
      probe.hash === ""
    );
  } catch {
    return false;
  }
}

/**
 * Build-time equivalent of normalizeBackendHostPattern in
 * shell/src/lib/backend-url.ts (scripts cannot import shell src — keep
 * the two in sync; they consume the same env var). Without this, the
 * "same semantics" claim above was false in exactly the misconfig cases
 * the runtime normalizes (SU7-F3): a scheme-bearing value baked
 * `https://https://…` into registry.json — which shells consume with NO
 * runtime re-derivation — a trailing slash shipped `host//route`
 * concatenations, and a degenerate value shipped unusable URLs instead
 * of falling back to the default. Warnings go to stderr (console.warn);
 * the {slug} check below stays the build-time fail-loud exception.
 */
function normalizeBackendHostPattern(raw: string): string {
  let normalized = raw.trim();
  if (normalized !== raw) {
    console.warn(
      `WARN: SHOWCASE_BACKEND_HOST_PATTERN ${JSON.stringify(raw)} contains ` +
        `surrounding whitespace — trimming.`,
    );
  }
  // Loop the scheme strip to convergence (parity with the runtime): a
  // single pass would leave "https://https://host" scheme-bearing.
  const strippedSchemes: string[] = [];
  for (
    let scheme = SCHEME_RE.exec(normalized);
    scheme;
    scheme = SCHEME_RE.exec(normalized)
  ) {
    strippedSchemes.push(scheme[0]);
    normalized = normalized.slice(scheme[0].length);
  }
  if (strippedSchemes.length > 0) {
    console.warn(
      `WARN: SHOWCASE_BACKEND_HOST_PATTERN ${JSON.stringify(raw)} includes ` +
        `a scheme — the generator prepends https://; stripping ` +
        strippedSchemes.map((s) => JSON.stringify(s)).join(", ") +
        `.`,
    );
  }
  if (/\/+$/.test(normalized)) {
    console.warn(
      `WARN: SHOWCASE_BACKEND_HOST_PATTERN ${JSON.stringify(raw)} has a ` +
        `trailing slash — route concatenation would yield "//"; trimming.`,
    );
    normalized = normalized.replace(/\/+$/, "");
  }
  if (!isUsableBackendHostPattern(normalized)) {
    console.warn(
      `WARN: SHOWCASE_BACKEND_HOST_PATTERN ${JSON.stringify(raw)} ` +
        `normalizes to ${JSON.stringify(normalized)}, which cannot form a ` +
        `usable backend URL — falling back to the default pattern ` +
        `${DEFAULT_BACKEND_HOST_PATTERN}.`,
    );
    return DEFAULT_BACKEND_HOST_PATTERN;
  }
  return normalized;
}

const BACKEND_HOST_PATTERN = normalizeBackendHostPattern(
  readBackendHostPatternEnv() ?? DEFAULT_BACKEND_HOST_PATTERN,
);

// {slug} placeholder validation — build-time fail-loud: a pattern without
// the placeholder bakes the SAME backend host into every integration's
// backend_url, silently. At runtime that is only an advisory warn (the
// request must still be served — see normalizeBackendHostPattern in
// shell/src/lib/backend-url.ts); here refusing is cheap and correct.
// stderr + process.exit(1) (not a bare throw) is the error contract this
// script's consumers rely on: vitest.global-setup.ts and CI run it with
// stdout ignored and stderr inherited, so a failure must surface as a
// non-zero exit with the reason on stderr.
if (!BACKEND_HOST_PATTERN.includes("{slug}")) {
  console.error(
    `ERROR: SHOWCASE_BACKEND_HOST_PATTERN ` +
      `${JSON.stringify(BACKEND_HOST_PATTERN)} lacks the {slug} ` +
      `placeholder — every integration would resolve to the same backend ` +
      `host. Fix the env var (default: ${DEFAULT_BACKEND_HOST_PATTERN}).`,
  );
  process.exit(1);
}

function synthesizeBackendUrl(slug: string): string {
  // replaceAll + function replacer — parity with the runtime consumer
  // (backendUrlFromPattern in shell/src/lib/backend-url.ts): replace()
  // substitutes only the FIRST {slug} occurrence, and a plain string
  // replacement is subject to `$` substitution patterns ("$&", "$'", …).
  return `https://${BACKEND_HOST_PATTERN.replaceAll("{slug}", () => slug)}`;
}

// Atomic write (SU4-A7): write to a temp sibling, then rename(2) into
// place. A concurrent reader (a vitest worker importing registry.json,
// a dev-server build) racing a bare writeFileSync could observe a
// half-written file — rename within the same directory is atomic on
// POSIX, so readers see either the old complete file or the new one.
// try/finally unlink (SU5-A5): a crash between write and rename used to
// litter the data dir with orphaned .tmp files. After a successful
// rename the tmp path no longer exists — rmSync(force:true) is a no-op.
/**
 * Temp-sibling path for atomic writes (exported for tests, SU7-F3).
 * `.<basename>.<16hex>.tmp` in the target's own directory — the EXACT
 * shape FileSnapshotRestorer's snapshot-time straggler sweep matches
 * (`^\.<basename>\.[0-9a-f]{16}\.tmp$` in __tests__/test-cleanup.ts).
 * The previous `<target>.<pid>.tmp` naming was invisible to that sweep,
 * so a SIGTERM-killed generator (the one crash mode the try/finally
 * below cannot clean up) accumulated un-swept stragglers in tracked
 * data directories.
 */
export function atomicTmpPath(filePath: string): string {
  const suffix = crypto.randomBytes(8).toString("hex");
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${suffix}.tmp`,
  );
}

function writeFileAtomicSync(filePath: string, contents: string): void {
  const tmpPath = atomicTmpPath(filePath);
  try {
    fs.writeFileSync(tmpPath, contents);
    fs.renameSync(tmpPath, filePath);
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}
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
const ANGULAR_SERVER_OUTPUT_DIR = path.join(
  ROOT,
  "angular",
  "server",
  "generated",
);
const ANGULAR_CLIENT_OUTPUT_DIR = path.join(
  ROOT,
  "angular",
  "src",
  "app",
  "generated",
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

/**
 * Read + parse a required JSON source under the labeled-stderr + exit(1)
 * contract (SU7-F3): a missing/unreadable/malformed file surfaces as a reasoned
 * `ERROR: …` on stderr, not a raw ENOENT/SyntaxError stack — matching the
 * constraints.yaml guard below and the peer validation gates.
 */
// Returns the parsed JSON with `any` typing to match the prior `JSON.parse`
// call sites (this script consumes these structurally without a schema type).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readJsonOrExit(filePath: string, label: string): any {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    console.error(
      `ERROR: failed to read ${label} ${filePath}: ${(e as Error).message}`,
    );
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(
      `ERROR: failed to parse ${label} ${filePath}: ${(e as Error).message}`,
    );
    process.exit(1);
  }
}

function loadSchema() {
  return readJsonOrExit(SCHEMA_PATH, "schema");
}

function loadFeatureRegistry() {
  return readJsonOrExit(FEATURE_REGISTRY_PATH, "feature registry");
}

function loadFrontendRegistry(
  features: Array<{ id: string; kind?: string; deprecated?: boolean }>,
) {
  const raw = fs.readFileSync(FRONTEND_REGISTRY_PATH, "utf-8");
  return normalizeFrontendRegistry(JSON.parse(raw), features);
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

function main() {
  console.log("Generating integration registry...\n");

  const schema = loadSchema();
  const featureRegistry = loadFeatureRegistry();
  const frontendRegistry = loadFrontendRegistry(featureRegistry.features);
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

    // yaml.parse returns null for an empty document and a scalar/array
    // for degenerate ones — validateManifest assumes a mapping and used
    // to TypeError on null (SU7-F3). Treat a non-mapping parse result
    // as a validation error like any other malformed manifest
    // (aggregated; exit 1 below).
    if (
      manifest === null ||
      typeof manifest !== "object" ||
      Array.isArray(manifest)
    ) {
      const shape =
        manifest === null
          ? "null"
          : Array.isArray(manifest)
            ? "an array"
            : `a ${typeof manifest}`;
      allErrors.push(
        `${manifestPath}: manifest must be a YAML mapping (parsed to ${shape})`,
      );
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

  // Dual-read for backend_url:
  //   manifest value (if present)  ->  synthesized from BACKEND_HOST_PATTERN
  //
  // Manifests no longer ship `backend_url` (PR2 stripped them all); the
  // synthesized value below is now the source of truth. Manifest-supplied
  // values are still honored for safety/backporting if any reappear.
  //
  // We rebuild each manifest object to insert `backend_url` immediately
  // after `copilotkit_version`, preserving the historical JSON key order so
  // the emitted registry.json stays byte-identical to the pre-PR1 output.
  for (let i = 0; i < integrations.length; i++) {
    const manifest = integrations[i] as Record<string, unknown>;
    const slug = manifest.slug as string;
    const existing = manifest.backend_url;
    const backendUrl =
      typeof existing === "string" && existing.length > 0
        ? existing
        : synthesizeBackendUrl(slug);

    // Rebuild with `backend_url` slotted right after `copilotkit_version` to
    // match the historical key order from YAML manifests.
    const rebuilt: Record<string, unknown> = {};
    let inserted = false;
    for (const [key, value] of Object.entries(manifest)) {
      if (key === "backend_url") continue;
      rebuilt[key] = value;
      if (key === "copilotkit_version") {
        rebuilt.backend_url = backendUrl;
        inserted = true;
      }
    }
    if (!inserted) rebuilt.backend_url = backendUrl;
    integrations[i] = rebuilt;
  }

  // Merge per-package docs-links.json overrides onto each integration *after*
  // schema validation, since `docs_links` isn't part of the manifest schema.
  // Best-effort: missing file or stale shapes are tolerated and don't error.
  for (const manifest of integrations) {
    const pkgDir = path.join(PACKAGES_DIR, manifest.slug as string);
    manifest.docs_links = loadDocsLinks(pkgDir, allErrors);
  }

  // Constraint validation. A missing or unreadable constraints.yaml
  // used to surface as a raw ENOENT stack (SU7-F3) — fail per the same
  // labeled stderr + exit(1) contract as the {slug} check and the
  // missing-reference check (consumers run with stdout ignored and
  // stderr inherited).
  let constraintsRaw: string;
  try {
    constraintsRaw = fs.readFileSync(CONSTRAINTS_PATH, "utf-8");
  } catch (e) {
    console.error(
      `ERROR: failed to read constraints file ${CONSTRAINTS_PATH}: ` +
        `${(e as Error).message}`,
    );
    process.exit(1);
  }
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
    packages = readJsonOrExit(PACKAGES_JSON_PATH, "packages") as Array<{
      slug: string;
      name: string;
    }>;
    console.log(`\nLoaded ${packages.length} packages from packages.json`);
  }

  const registry = {
    feature_registry: featureRegistry,
    frontend_registry: frontendRegistry,
    integrations,
    packages,
  };

  // Compute and serialize ALL outputs BEFORE the first file write
  // (SU5-A5): catalog generation used to run AFTER the registry and
  // constraints files were already on disk, so a generateCatalog throw
  // left a partial multi-file emit (fresh registry.json, stale or
  // missing catalog.json). All-or-nothing: any failure below this
  // comment exits before a single byte is written.
  const registryJson = JSON.stringify(registry, null, 2) + "\n";
  const frontendRegistryJson = JSON.stringify(frontendRegistry, null, 2) + "\n";
  const constraintsJson = JSON.stringify(constraints, null, 2) + "\n";

  // --- Catalog generation (D0-D4 dashboard matrix) ---
  // `generateCatalog` is the SINGLE flattening authority shared with the live
  // harness, so it THROWS (never `process.exit`s) on a fatal input. Here — the
  // CLI consumer — we own the error contract: a missing reference integration
  // becomes the labeled stderr + exit(1) that CI/global-setup expect (they run
  // with stdout ignored and stderr inherited).
  let catalog: ReturnType<typeof generateCatalog>;
  try {
    catalog = generateCatalog(featureRegistry, integrations);
  } catch (e) {
    if (e instanceof MissingReferenceIntegrationError) {
      console.error(`ERROR: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
  const catalogJson = JSON.stringify(catalog, null, 2) + "\n";
  const frontendCatalog = generateFrontendCatalog(
    frontendRegistry,
    catalog.cells,
  );
  const frontendCatalogJson = JSON.stringify(frontendCatalog, null, 2) + "\n";

  for (const dir of OUTPUT_DIRS) {
    fs.mkdirSync(dir, { recursive: true });
    const outputPath = path.join(dir, "registry.json");
    writeFileAtomicSync(outputPath, registryJson);
    console.log(
      `\nRegistry generated: ${outputPath} (${integrations.length} integrations)`,
    );
    const frontendRegistryOutputPath = path.join(dir, "frontend-registry.json");
    writeFileAtomicSync(frontendRegistryOutputPath, frontendRegistryJson);
    console.log(
      `Frontend registry generated: ${frontendRegistryOutputPath} ` +
        `(${frontendRegistry.frontends.length} frontends)`,
    );
  }

  // The Angular host keeps backend routing evidence in server-only generated
  // data. Browser code receives only frontend/cell identities, never the
  // registry's synthesized backend_url values.
  fs.mkdirSync(ANGULAR_SERVER_OUTPUT_DIR, { recursive: true });
  writeFileAtomicSync(
    path.join(ANGULAR_SERVER_OUTPUT_DIR, "registry.json"),
    registryJson,
  );
  writeFileAtomicSync(
    path.join(ANGULAR_SERVER_OUTPUT_DIR, "frontend-catalog.json"),
    frontendCatalogJson,
  );
  fs.mkdirSync(ANGULAR_CLIENT_OUTPUT_DIR, { recursive: true });
  writeFileAtomicSync(
    path.join(ANGULAR_CLIENT_OUTPUT_DIR, "frontend-registry.json"),
    frontendRegistryJson,
  );
  writeFileAtomicSync(
    path.join(ANGULAR_CLIENT_OUTPUT_DIR, "frontend-catalog.json"),
    JSON.stringify(
      {
        cells: frontendCatalog.cells
          .filter((cell) => cell.frontend === "angular")
          .map((cell) => ({
            id: cell.id,
            frontend: cell.frontend,
            integration: cell.integration,
            feature: cell.feature,
            frontend_status: cell.frontend_status,
            backend_status: cell.backend_status,
            runnable: cell.runnable,
            exception: cell.exception,
          })),
      },
      null,
      2,
    ) + "\n",
  );

  // Write constraints.json for the shell's client-side filtering
  writeFileAtomicSync(CONSTRAINTS_OUTPUT_PATH, constraintsJson);
  console.log(`Constraints written: ${CONSTRAINTS_OUTPUT_PATH}`);

  for (const dir of OUTPUT_DIRS) {
    const catalogPath = path.join(dir, "catalog.json");
    writeFileAtomicSync(catalogPath, catalogJson);
    console.log(
      `Catalog generated: ${catalogPath} (${catalog.metadata.total_cells} cells)`,
    );
    const frontendCatalogPath = path.join(dir, "frontend-catalog.json");
    writeFileAtomicSync(frontendCatalogPath, frontendCatalogJson);
    console.log(
      `Frontend catalog generated: ${frontendCatalogPath} ` +
        `(${frontendCatalog.metadata.runnable} runnable cells)`,
    );
  }
}

// Direct-run guard (SU7-F3): execute main() only when this file is the
// CLI entry — every real invocation (`tsx generate-registry.ts` from the
// shells' dev/build scripts, vitest.global-setup, CI, the test
// harnesses) runs it directly, and tsx sets process.argv[1] to the
// resolved script path. Importing the module (unit tests import
// atomicTmpPath) must not regenerate the registry as a side effect.
// realpath both sides so a symlinked cwd/tmpdir can't produce a false
// negative.
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(path.resolve(entry)) === fs.realpathSync(__filename);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main();
}
