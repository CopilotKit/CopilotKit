import path from "node:path";
import fs from "node:fs";
import yaml from "js-yaml";
import type { LocalConfig } from "./config.js";
import { getPackageUrl } from "./config.js";

export type TestLevel = "smoke" | "d4" | "d5" | "all";

export interface TestTarget {
  slug: string;
  /** Undefined means all demos for this slug. */
  demo?: string;
  level: TestLevel;
}

/**
 * Manifest shape — subset of each integration's manifest.yaml that the
 * CLI consumes. The full manifest has many more fields (category, logo,
 * partner_docs, etc.) that aren't relevant for local test execution.
 */
interface Manifest {
  slug: string;
  name: string;
  demos: Array<{ id: string; features?: string[] }>;
  features?: string[];
  deployed?: boolean;
}

// ---------------------------------------------------------------------------
// Driver input types — these match the Zod inputSchema shapes declared in
// the actual probe drivers so the CLI can construct valid inputs without
// going through the driver module (which may pull in Playwright, etc.).
// ---------------------------------------------------------------------------

/**
 * Liveness (smoke) driver input — mirrors the `discoverySmokeInputSchema`
 * branch in `src/probes/drivers/liveness.ts`. The CLI always uses the
 * discovery shape (key + name + publicUrl) rather than the static shape
 * (key + url) because local port mapping naturally produces a base URL,
 * not a full `/smoke` endpoint path.
 */
export interface SmokeInput {
  key: string;
  name: string;
  publicUrl: string;
  shape: "package";
  [k: string]: unknown;
}

/**
 * e2e-chat-tools (L4) driver input — mirrors the `inputSchema` in
 * `src/probes/drivers/e2e-chat-tools.ts`. `backendUrl` or `publicUrl`
 * is required (the schema has a `.refine()` enforcing this). The CLI
 * sets `backendUrl` from local-ports and populates `demos` from the
 * manifest so the driver knows which demo routes to exercise.
 */
export interface ChatToolsInput {
  key: string;
  backendUrl: string;
  name: string;
  demos: string[];
  shape: "package";
  [k: string]: unknown;
}

/**
 * e2e-deep (D5) driver input — mirrors the `inputSchema` in
 * `src/probes/drivers/e2e-deep.ts`. `backendUrl` or `publicUrl` is
 * required. The CLI sets `backendUrl` from local-ports and populates
 * `demos` from the manifest's top-level `features` array (registry IDs
 * that the driver maps to D5 feature types via `demosToFeatureTypes()`).
 */
export interface DeepInput {
  key: string;
  backendUrl: string;
  name: string;
  demos: string[];
  shape: "package";
}

// ---------------------------------------------------------------------------
// Parsing & resolution
// ---------------------------------------------------------------------------

/**
 * Parse a raw target string like `"crewai-crews"` or
 * `"crewai-crews:agentic-chat"` into slug + optional demo.
 */
export function parseTarget(raw: string): { slug: string; demo?: string } {
  const idx = raw.indexOf(":");
  if (idx === -1) {
    return { slug: raw };
  }
  return {
    slug: raw.slice(0, idx),
    demo: raw.slice(idx + 1) || undefined,
  };
}

/** Return all slugs that have a local port mapping. */
export function listAvailableSlugs(config: LocalConfig): string[] {
  return Object.keys(config.localPorts);
}

/**
 * Load and parse an integration's manifest.yaml. Looks under
 * `showcase/integrations/<slug>/manifest.yaml` first, then falls back
 * to the legacy `showcase/packages/<slug>/manifest.yaml` path.
 */
export function loadManifest(slug: string, config: LocalConfig): Manifest {
  const integrationsPath = path.join(
    config.showcaseDir,
    "integrations",
    slug,
    "manifest.yaml",
  );
  const packagesPath = path.join(
    config.showcaseDir,
    "packages",
    slug,
    "manifest.yaml",
  );

  let manifestPath: string;
  if (fs.existsSync(integrationsPath)) {
    manifestPath = integrationsPath;
  } else if (fs.existsSync(packagesPath)) {
    manifestPath = packagesPath;
  } else {
    throw new Error(
      `Manifest not found for slug "${slug}". Checked:\n  ${integrationsPath}\n  ${packagesPath}`,
    );
  }

  const raw = fs.readFileSync(manifestPath, "utf-8");
  const parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA });

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid manifest for ${slug}: expected YAML mapping`);
  }

  const manifest = parsed as Record<string, unknown>;

  if (typeof manifest.slug !== "string") {
    throw new Error(`Manifest for ${slug} missing required "slug" field`);
  }

  if (Array.isArray(manifest.demos)) {
    for (const demo of manifest.demos) {
      if (
        typeof demo !== "object" ||
        demo === null ||
        typeof (demo as Record<string, unknown>).id !== "string"
      ) {
        throw new Error(
          `Invalid demo entry in manifest for ${slug}: each demo must have a string "id" field`,
        );
      }
    }
  }

  if (manifest.features !== undefined && !Array.isArray(manifest.features)) {
    throw new Error(
      `Invalid "features" in manifest for ${slug}: expected array`,
    );
  }

  return {
    slug: manifest.slug as string,
    name: (manifest.name as string) ?? slug,
    demos: Array.isArray(manifest.demos)
      ? (manifest.demos as Array<{ id: string; features?: string[] }>)
      : [],
    features: Array.isArray(manifest.features)
      ? (manifest.features as string[])
      : undefined,
    deployed: manifest.deployed as boolean | undefined,
  };
}

// ---------------------------------------------------------------------------
// Driver input builders
// ---------------------------------------------------------------------------

/**
 * Build smoke (liveness) driver inputs for the given target.
 */
export function buildSmokeInputs(
  target: TestTarget,
  config: LocalConfig,
): SmokeInput[] {
  const slugs = [target.slug];

  return slugs.map((slug) => {
    void loadManifest(slug, config); // ensures the slug is real
    // The driver's `deriveSlug` for discovery-mode inputs takes
    // `input.name` and strips a leading `showcase-` prefix. In production
    // discovery `name` is the Railway service name (`showcase-<slug>`),
    // so the derived slug matches the rest of the row keyspace
    // (`smoke:<slug>`, `health:<slug>`, etc.). The CLI was previously
    // passing `manifest.name` (the display name like "LangGraph (Python)")
    // which stripped to itself, producing rows like
    // `health:LangGraph (Python)` that didn't join with anything else
    // on the dashboard. Use the showcase-prefixed slug shape to mirror
    // production.
    return {
      key: `smoke:${slug}`,
      name: `showcase-${slug}`,
      publicUrl: getPackageUrl(slug, config),
      shape: "package" as const,
    };
  });
}

/**
 * Build e2e-chat-tools (L4) driver inputs. Reads each manifest to
 * populate the `demos` array so the driver knows which demo routes to
 * exercise. When `target.demo` is set, filters to just that demo.
 */
export function buildChatToolsInputs(
  target: TestTarget,
  config: LocalConfig,
): ChatToolsInput[] {
  const slugs = [target.slug];

  return slugs.map((slug) => {
    const manifest = loadManifest(slug, config);
    let demoIds = manifest.demos.map((d) => d.id);

    if (target.demo) {
      demoIds = demoIds.filter((id) => id === target.demo);
      if (demoIds.length === 0) {
        const available = manifest.demos.map((d) => d.id).join(", ");
        throw new Error(
          `Demo "${target.demo}" not found in ${slug}. Available: ${available}`,
        );
      }
    }

    return {
      key: `d4:${slug}`,
      backendUrl: getPackageUrl(slug, config),
      name: manifest.name,
      demos: demoIds,
      shape: "package" as const,
    };
  });
}

/**
 * Build e2e-deep (D5) driver inputs. Reads the manifest's top-level
 * `features` array. When `target.demo` is set, filters features to
 * just that demo ID (the features list in the manifest uses the same
 * identifiers as demo IDs).
 */
export function buildDeepInputs(
  target: TestTarget,
  config: LocalConfig,
): DeepInput[] {
  const slugs = [target.slug];

  return slugs
    .map((slug) => {
      const manifest = loadManifest(slug, config);
      let features = manifest.features ?? [];

      if (target.demo) {
        features = features.filter((f) => f === target.demo);
        if (features.length === 0) {
          const available = (manifest.features ?? []).join(", ");
          throw new Error(
            `Feature "${target.demo}" not found in ${slug}. Available: ${available}`,
          );
        }
      }

      return {
        key: `e2e-deep:${slug}`,
        backendUrl: getPackageUrl(slug, config),
        name: manifest.name,
        demos: features,
        shape: "package" as const,
      };
    })
    .filter((input) => input.demos.length > 0);
}

/**
 * Parse a raw target string, expand `"all"` to every slug with a local
 * port mapping, and return a `TestTarget[]`.
 */
export function resolveTargets(
  raw: string,
  level: TestLevel,
  config: LocalConfig,
): TestTarget[] {
  const { slug, demo } = parseTarget(raw);

  if (slug === "all" && demo) {
    throw new Error(
      'Cannot specify a demo filter with target "all". Use a specific slug instead.',
    );
  }

  if (slug === "all") {
    return listAvailableSlugs(config).map((s) => ({
      slug: s,
      level,
    }));
  }

  // Validate the slug has a port mapping.
  if (!config.localPorts[slug]) {
    throw new Error(
      `Unknown slug "${slug}". Available: ${listAvailableSlugs(config).join(", ")}`,
    );
  }

  return [{ slug, demo, level }];
}
