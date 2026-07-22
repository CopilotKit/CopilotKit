import frontendCatalogData from "./generated/frontend-catalog.json";
import type { ActivatedRoute } from "@angular/router";

interface AgentCatalog {
  cells: Array<{ id: string; agent_id?: string }>;
}

const defaultAgentCatalog = frontendCatalogData as AgentCatalog;

const THREAD_ID_OVERRIDES: Readonly<Record<string, string>> = {
  "threadid-frontend-tool-roundtrip": "a9e7e9c4-6c72-4b8a-9d74-c5c0e05f6580",
};

/** Resolve the backend agent used by an exact shared integration contract. */
export function agentIdForFeature(
  feature: string,
  integration: string,
  catalog: AgentCatalog = defaultAgentCatalog,
): string {
  const cellId = `angular/${integration}/${feature}`;
  const agentId = catalog.cells.find((cell) => cell.id === cellId)?.agent_id;
  if (agentId === undefined) {
    throw new Error(`Showcase cell "${cellId}" does not declare agent_id.`);
  }
  return agentId;
}

/** Resolve the generated agent identifier for an activated Showcase route. */
export function agentIdForRoute(
  feature: string,
  route: ActivatedRoute,
): string {
  const integration = route.snapshot.paramMap.get("integration");
  if (integration === null) {
    throw new Error(`Showcase feature "${feature}" has no integration route.`);
  }
  return agentIdForFeature(feature, integration);
}

/** Resolve an explicit thread required by a feature-level regression contract. */
export function threadIdForFeature(feature: string): string | undefined {
  return THREAD_ID_OVERRIDES[feature];
}
