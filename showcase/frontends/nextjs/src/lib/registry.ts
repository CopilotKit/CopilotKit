// The app's view of every showcase/integrations/<slug>/manifest.yaml. It
// reads src/data/registry.json, which showcase/scripts/generate-registry.ts
// writes before dev, build, typecheck, test and e2e.
import registryData from "@/data/registry.json";

/** A demo page. Its URL is /demos/<integration>/<id>. */
export interface Demo {
  id: string;
  name: string;
  description: string;
}

/** An integration and the demo pages its manifest lists. */
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
    demos.set(id, { id, name: entry.name, description: entry.description });
  }
  return [...demos.values()];
}

const manifests: Manifest[] = registryData.integrations;

const integrations: Integration[] = manifests.map((manifest) => ({
  slug: manifest.slug,
  name: manifest.name,
  description: manifest.description,
  demos: toDemos(manifest.demos),
}));

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
 * Returns `undefined` when the integration is unknown or its manifest does not
 * list that page.
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
