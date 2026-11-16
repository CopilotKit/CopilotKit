// The app's view of every showcase/integrations/<slug>/manifest.yaml, plus the
// extra demos of each integration. It reads two generated files:
// - src/data/registry.json, which showcase/scripts/generate-registry.ts writes;
// - src/data/extra-demos.json, which scripts/collect-extra-demos.ts writes from
//   src/integrations/<slug>/extra-demos.json.
// The pre* npm scripts write both before dev, build, typecheck, test and e2e.
import extraDemosData from "@/data/extra-demos.json";
import registryData from "@/data/registry.json";

/** A demo page. Its URL is /demos/<integration>/<id>. */
export interface Demo {
  id: string;
  name: string;
  description: string;
  /**
   * `true` for an extra demo: a page that the integration's manifest has no
   * route for, but that src/integrations/<slug>/extra-demos.json lists.
   */
  extra: boolean;
}

/**
 * An integration and its demo pages: first the pages its manifest lists, then
 * its extra demos.
 */
export interface Integration {
  slug: string;
  name: string;
  description: string;
  demos: Demo[];
}

/** The fields this app reads from one entry of a manifest's `demos` list. */
interface ManifestDemo {
  name: string;
  description: string;
  route?: string;
}

/** The fields this app reads from one manifest. */
interface Manifest {
  slug: string;
  name: string;
  description: string;
  demos: ManifestDemo[];
}

const DEMO_ROUTE_PREFIX = "/demos/";

// One demo per page. Two manifest entries can share a route (for example
// hitl-in-chat-booking uses /demos/hitl-in-chat); the first entry names the
// page. An entry without a route, such as a CLI command, has no page.
function toDemos(entries: ManifestDemo[]) {
  const demos = new Map<string, Demo>();
  for (const entry of entries) {
    const route = entry.route;
    if (route === undefined || !route.startsWith(DEMO_ROUTE_PREFIX)) continue;
    const id = route.slice(DEMO_ROUTE_PREFIX.length);
    if (demos.has(id)) continue;
    demos.set(id, {
      id,
      name: entry.name,
      description: entry.description,
      extra: false,
    });
  }
  return [...demos.values()];
}

const manifests: Manifest[] = registryData.integrations;
// The extra demo ids of each integration, by slug. An integration without
// extra demos has no key.
const extraDemoIds: Partial<Record<string, string[]>> = extraDemosData;

const listings = manifests.map((manifest) => ({
  manifest,
  demos: toDemos(manifest.demos),
}));
const listedDemos = listings.flatMap((listing) => listing.demos);

// "byoc-hashbrown" -> "Byoc Hashbrown".
function nameFromId(id: string) {
  return id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// An extra demo has no manifest entry of its own, so it has no description.
// It takes the name that the first manifest, in registry order, gives the
// same page. Descriptions are not taken, because they often name their own
// integration. When no manifest lists the page, the name comes from the id.
function toExtraDemo(id: string) {
  const namesake = listedDemos.find((demo) => demo.id === id);
  return {
    id,
    name: namesake?.name ?? nameFromId(id),
    description: "",
    extra: true,
  };
}

const integrations: Integration[] = listings.map(({ manifest, demos }) => {
  const extraIds = extraDemoIds[manifest.slug] ?? [];
  return {
    slug: manifest.slug,
    name: manifest.name,
    description: manifest.description,
    demos: [...demos, ...extraIds.map(toExtraDemo)],
  };
});

/** Every integration, in the registry's order. */
export function getIntegrations() {
  return integrations;
}

/** The integration with this slug, or `undefined` when no manifest has it. */
export function getIntegration(slug: string) {
  return integrations.find((integration) => integration.slug === slug);
}

/**
 * The integration and the demo page for /demos/<integration>/<demo>.
 *
 * Returns `undefined` when the integration is unknown, or when the page is
 * neither in the integration's manifest nor in its extra demos.
 *
 * @example
 * const entry = getDemo("strands", "agentic-chat");
 * if (entry) console.log(`${entry.integration.name} - ${entry.demo.name}`);
 */
export function getDemo(integrationSlug: string, demoId: string) {
  const integration = getIntegration(integrationSlug);
  const demo = integration?.demos.find((candidate) => candidate.id === demoId);
  if (integration === undefined || demo === undefined) return undefined;
  return { integration, demo };
}

/**
 * Reads the integration and demo segments of a /demos/<integration>/<demo>
 * path. A segment the path does not have is `undefined`.
 */
export function parseDemoPath(pathname: string) {
  const segments = pathname.split("/").filter((segment) => segment !== "");
  const isDemoPath = segments.at(0) === "demos";
  return {
    integration: isDemoPath ? segments.at(1) : undefined,
    demo: isDemoPath ? segments.at(2) : undefined,
  };
}
