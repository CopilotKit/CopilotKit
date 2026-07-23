/**
 * Runtime-Route Wiring Validator (OSS-451 guard)
 *
 * Every showcase demo page wires a CopilotKit provider with
 * `runtimeUrl="/api/copilotkit[-<demo>]"`. If that Next.js route handler does
 * not exist, the client's runtime-info fetch 404s, the provider never
 * initializes (`runtime_info_fetch_failed`) and the page is dead on load.
 *
 * That is exactly how OSS-451 shipped: three Mastra demo pages were mirrored
 * from the langgraph-python north-star (which has per-demo routes) without
 * porting the route handlers. Nothing linked a page's `runtimeUrl` string to
 * the existence of the route it names, so the drift was invisible to the only
 * automatic pre-merge gate (a Docker *build*, which compiles a page that
 * references a non-existent route just fine).
 *
 * This validator closes that gap. For every SHIPPED demo — a demo directory
 * whose slug is listed in the integration's `manifest.yaml` `features` — it
 * asserts that every `runtimeUrl` the demo declares resolves to a real route
 * directory under `src/app/api/`. Demos not listed in `features` (unshipped /
 * experimental placeholders) and `not_supported_features` are skipped: they
 * are not claimed to work, so they are not gated — but the moment one is
 * promoted into `features`, this guard starts enforcing it.
 *
 * A `validate-runtime-routes.baseline.json` grandfathers known pre-existing
 * violations (same idea as the pin-drift `fail-baseline.json`) so wiring this
 * into CI fails only on NEW drift, not on unrelated debt. Stale baseline
 * entries (no longer violations) are reported so the baseline can shrink.
 *
 * Usage:
 *   npx tsx showcase/scripts/validate-runtime-routes.ts --all
 *   npx tsx showcase/scripts/validate-runtime-routes.ts <slug> [<slug> ...]
 *   npx tsx showcase/scripts/validate-runtime-routes.ts --all --json
 *
 * Exit code 0 = clean (no non-baselined violations); 1 = violations found.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_ROOT = path.resolve(__dirname, "..");
const INTEGRATIONS_DIR = path.join(SHOWCASE_ROOT, "integrations");
const BASELINE_PATH = path.join(
  __dirname,
  "validate-runtime-routes.baseline.json",
);

export interface Violation {
  /** integration slug, e.g. "mastra" */
  integration: string;
  /** demo directory / slug, e.g. "a2ui-fixed-schema" */
  demo: string;
  /** the runtimeUrl the page declares, e.g. "/api/copilotkit-a2ui-fixed-schema" */
  runtimeUrl: string;
  /** repo-relative route dir that was expected to exist but does not */
  expectedRouteDir: string;
  /** stable key used for baselining */
  key: string;
}

interface Manifest {
  slug?: string;
  features?: string[];
  not_supported_features?: string[];
}

/** All `runtimeUrl="..."` / `runtimeUrl='...'` string literals in a file. */
function extractRuntimeUrls(source: string): string[] {
  const urls = new Set<string>();
  const re = /runtimeUrl\s*=\s*(?:\{\s*)?["'`]([^"'`]+)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    urls.add(m[1]);
  }
  return [...urls];
}

/**
 * Map a runtimeUrl to the route directory that must exist for it to resolve.
 * "/api/copilotkit-foo" -> "<integration>/src/app/api/copilotkit-foo".
 * Returns null for non-local URLs (absolute http(s), env-driven) which this
 * static check cannot resolve.
 */
function routeDirForUrl(integrationDir: string, url: string): string | null {
  if (!url.startsWith("/api/")) return null;
  // Strip query/hash and any trailing slash; keep the first path segment
  // after /api/ as the route directory (catch-all handlers live in a nested
  // [[...slug]] dir, but the top-level route dir is what we assert exists).
  const cleaned = url.split(/[?#]/)[0].replace(/\/+$/, "");
  const seg = cleaned.slice("/api/".length).split("/")[0];
  if (!seg) return null;
  return path.join(integrationDir, "src", "app", "api", seg);
}

function loadManifest(integrationDir: string): Manifest | null {
  const p = path.join(integrationDir, "manifest.yaml");
  if (!fs.existsSync(p)) return null;
  try {
    return (yaml.parse(fs.readFileSync(p, "utf-8")) as Manifest) ?? null;
  } catch {
    return null;
  }
}

function listDemoDirs(integrationDir: string): string[] {
  const demosDir = path.join(integrationDir, "src", "app", "demos");
  if (!fs.existsSync(demosDir)) return [];
  return fs
    .readdirSync(demosDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

/** All .ts/.tsx source under a demo directory (recursively). */
function demoSourceFiles(demoDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(t|j)sx?$/.test(e.name)) out.push(full);
    }
  };
  walk(demoDir);
  return out;
}

/** Validate a single integration; returns its violations. */
export function validateIntegration(integrationDir: string): Violation[] {
  const slug = path.basename(integrationDir);
  const manifest = loadManifest(integrationDir);
  if (!manifest) return [];
  const features = new Set(manifest.features ?? []);
  const notSupported = new Set(manifest.not_supported_features ?? []);
  const violations: Violation[] = [];

  const demosDir = path.join(integrationDir, "src", "app", "demos");
  for (const demo of listDemoDirs(integrationDir)) {
    // Only gate SHIPPED demos: slug present in `features` and not explicitly
    // marked unsupported. Unshipped placeholders are intentionally skipped.
    if (!features.has(demo) || notSupported.has(demo)) continue;

    const demoDir = path.join(demosDir, demo);
    const urls = new Set<string>();
    for (const f of demoSourceFiles(demoDir)) {
      for (const u of extractRuntimeUrls(fs.readFileSync(f, "utf-8"))) {
        urls.add(u);
      }
    }

    for (const url of urls) {
      const routeDir = routeDirForUrl(integrationDir, url);
      if (routeDir === null) continue; // non-local (absolute/env) — not gated
      if (!fs.existsSync(routeDir)) {
        const expectedRouteDir = path.relative(
          path.resolve(SHOWCASE_ROOT, ".."),
          routeDir,
        );
        violations.push({
          integration: slug,
          demo,
          runtimeUrl: url,
          expectedRouteDir,
          key: `${slug}:${demo}:${url}`,
        });
      }
    }
  }
  return violations;
}

function loadBaseline(): Set<string> {
  if (!fs.existsSync(BASELINE_PATH)) return new Set();
  try {
    const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8"));
    const keys: string[] = Array.isArray(parsed) ? parsed : (parsed.keys ?? []);
    return new Set(keys);
  } catch {
    return new Set();
  }
}

function resolveTargets(args: string[]): string[] {
  const slugs = args.filter((a) => !a.startsWith("--"));
  if (args.includes("--all") || slugs.length === 0) {
    return fs
      .readdirSync(INTEGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(INTEGRATIONS_DIR, e.name));
  }
  return slugs.map((s) => path.join(INTEGRATIONS_DIR, s));
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const targets = resolveTargets(args);

  const all: Violation[] = [];
  for (const dir of targets) {
    if (!fs.existsSync(dir)) {
      console.error(`✖ unknown integration: ${path.basename(dir)}`);
      process.exit(2);
    }
    all.push(...validateIntegration(dir));
  }

  const baseline = loadBaseline();
  const fresh = all.filter((v) => !baseline.has(v.key));
  const baselinedHit = new Set(
    all.filter((v) => baseline.has(v.key)).map((v) => v.key),
  );
  const staleBaseline = [...baseline].filter((k) => !baselinedHit.has(k));

  if (asJson) {
    console.log(JSON.stringify({ violations: fresh, staleBaseline }, null, 2));
  } else {
    if (fresh.length === 0) {
      console.log(
        `✔ runtime-route wiring OK — every shipped demo's runtimeUrl resolves to a route (${all.length} baselined).`,
      );
    } else {
      console.error(
        `✖ ${fresh.length} shipped demo(s) point runtimeUrl at a route that does not exist:\n`,
      );
      for (const v of fresh) {
        console.error(
          `  • ${v.integration}/${v.demo}: runtimeUrl "${v.runtimeUrl}" → missing ${v.expectedRouteDir}`,
        );
      }
      console.error(
        `\nThis is the OSS-451 failure class: the page will 404 on load (runtime_info_fetch_failed).\n` +
          `Fix by adding the route handler, or repointing the page at an existing route.\n` +
          `If a violation is known/intentional, add its key to validate-runtime-routes.baseline.json.`,
      );
    }
    if (staleBaseline.length > 0) {
      console.warn(
        `\nℹ ${staleBaseline.length} stale baseline entr(y/ies) no longer violate — remove them:\n` +
          staleBaseline.map((k) => `  • ${k}`).join("\n"),
      );
    }
  }

  process.exit(fresh.length > 0 ? 1 : 0);
}

// Only run as CLI when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
