// Collects the extra demos of every integration into src/data/extra-demos.json.
//
// An extra demo is a demo page that the app serves for an integration, but
// that the integration's manifest has no route for. Each integration lists its
// extra demo ids in src/integrations/<slug>/extra-demos.json. This script checks
// each list against src/data/registry.json and writes all of them as
// { [slug]: string[] }. src/lib/registry.ts merges them into the demos.
//
// It needs registry.json, so it runs after showcase/scripts/generate-registry.ts.
// The pre* npm scripts run the two in that order.
//
// Usage (from showcase/frontends/nextjs): npx tsx scripts/collect-extra-demos.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isKebabCase } from "../src/lib/integration-modules";

/** The fields this script reads from src/data/registry.json. */
interface Registry {
  integrations: {
    slug: string;
    demos: { route?: string }[];
  }[];
}

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const INTEGRATIONS_DIR = path.join(APP_DIR, "src", "integrations");
const REGISTRY_PATH = path.join(APP_DIR, "src", "data", "registry.json");
const OUTPUT_PATH = path.join(APP_DIR, "src", "data", "extra-demos.json");
const LIST_FILE_NAME = "extra-demos.json";

function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

// The problems in one integration's list. `routes` holds the routes of the
// integration's manifest. An empty result means that the list is valid.
function findProblems(ids: string[], routes: Set<string>) {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!isKebabCase(id)) {
      problems.push(`"${id}" is not kebab-case.`);
    }
    if (routes.has(`/demos/${id}`)) {
      problems.push(
        `"${id}" is already in the manifest (route /demos/${id}). Remove it from this list.`,
      );
    }
    if (seen.has(id)) {
      problems.push(`"${id}" is in the list more than once.`);
    }
    seen.add(id);
  }
  return problems;
}

if (!fs.existsSync(REGISTRY_PATH)) {
  console.error(
    `ERROR: ${path.relative(APP_DIR, REGISTRY_PATH)} does not exist. Run showcase/scripts/generate-registry.ts first.`,
  );
  process.exit(1);
}
const registry: Registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
// A manifest entry without a route, such as a CLI command, adds nothing.
const manifestRoutes = new Map(
  registry.integrations.map((integration) => [
    integration.slug,
    new Set(
      integration.demos.flatMap((demo) =>
        demo.route === undefined ? [] : [demo.route],
      ),
    ),
  ]),
);

const folders = fs
  .readdirSync(INTEGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const extraDemos: Record<string, string[]> = {};
const errors: string[] = [];
for (const slug of folders) {
  const listPath = path.join(INTEGRATIONS_DIR, slug, LIST_FILE_NAME);
  if (!fs.existsSync(listPath)) continue;

  const label = path.relative(APP_DIR, listPath);
  const routes = manifestRoutes.get(slug);
  if (routes === undefined) {
    errors.push(`${label}: no manifest has the integration "${slug}".`);
    continue;
  }

  let ids: unknown;
  try {
    ids = JSON.parse(fs.readFileSync(listPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    errors.push(`${label}: not valid JSON (${reason}).`);
    continue;
  }
  if (!isStringList(ids)) {
    errors.push(`${label}: must be a JSON array of demo ids.`);
    continue;
  }

  const problems = findProblems(ids, routes);
  for (const problem of problems) errors.push(`${label}: ${problem}`);
  extraDemos[slug] = ids;
}

if (errors.length > 0) {
  console.error("ERROR: the extra demo lists are not valid:");
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(extraDemos, null, 2)}\n`);
const demoCount = Object.values(extraDemos).flat().length;
const integrationCount = Object.keys(extraDemos).length;
console.log(
  `Wrote ${path.relative(APP_DIR, OUTPUT_PATH)} (${demoCount} extra demos for ${integrationCount} integrations)`,
);
