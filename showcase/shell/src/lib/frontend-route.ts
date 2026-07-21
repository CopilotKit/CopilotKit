import frontendCatalogData from "@/data/frontend-catalog.json";
import frontendRegistryData from "@/data/frontend-registry.json";

import { resolveBackendUrl } from "./backend-url";
import { getDemo, getFeature, getIntegration } from "./registry";

type FrontendSupportState =
  | "supported"
  | "docs-only"
  | "not-supported"
  | "not-applicable"
  | "quarantined";

interface FrontendCatalogCell {
  id: string;
  frontend: string;
  integration: string;
  feature: string;
  frontend_status: FrontendSupportState;
  backend_status: "wired" | "stub" | "unshipped" | "unsupported";
  runnable: boolean;
  exception: {
    reason: string;
    owner: string;
    review_date: string;
    issue?: string;
  } | null;
}

interface FrontendIdentity {
  id: string;
  name: string;
  runnable: boolean;
}

export interface ResolveShowcaseCellInput {
  frontend: string;
  integration: string;
  feature: string;
  backendHostPattern: string;
  angularHostUrl?: string;
}

export type ShowcaseCellResolution =
  | {
      kind: "runnable";
      cellId: string;
      frontend: FrontendIdentity;
      integrationName: string;
      featureName: string;
      iframeUrl: string;
    }
  | {
      kind:
        | "unavailable"
        | "docs-only"
        | "not-supported"
        | "not-applicable"
        | "quarantined"
        | "backend-unavailable";
      cellId: string;
      frontend: FrontendIdentity;
      integrationName: string;
      featureName: string;
      reason: string;
      exception: FrontendCatalogCell["exception"];
    }
  | { kind: "malformed"; reason: string };

const frontendCatalog = frontendCatalogData as {
  cells: FrontendCatalogCell[];
};
const frontendRegistry = frontendRegistryData as {
  default_frontend: string;
  frontends: FrontendIdentity[];
};

const frontendById = new Map(
  frontendRegistry.frontends.map((frontend) => [frontend.id, frontend]),
);
const cellById = new Map(frontendCatalog.cells.map((cell) => [cell.id, cell]));

/** Return the runnable frontend identities in registry order. */
export function getRunnableFrontends(): readonly FrontendIdentity[] {
  return frontendRegistry.frontends.filter((frontend) => frontend.runnable);
}

/** Build the frontend-aware canonical route for one Showcase cell. */
export function canonicalDemoPath(
  frontend: string,
  integration: string,
  feature: string,
): string {
  return `/${encodeURIComponent(frontend)}/${encodeURIComponent(integration)}/${encodeURIComponent(feature)}`;
}

/** Map a legacy React-default demo URL to its canonical frontend route. */
export function legacyDemoRedirect(
  integration: string,
  feature: string,
  view?: "preview" | "code",
): string {
  const base = canonicalDemoPath(
    frontendRegistry.default_frontend,
    integration,
    feature,
  );
  return view === undefined ? base : `${base}/${view}`;
}

function normalizedAngularHostUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function unavailableReason(cell: FrontendCatalogCell): string {
  if (cell.exception) return cell.exception.reason;
  if (cell.frontend_status === "docs-only") {
    return "This feature is documented but does not have a runnable demo.";
  }
  if (cell.backend_status !== "wired") {
    return `This backend does not provide a runnable ${cell.feature} fixture.`;
  }
  return "This Showcase cell is not runnable.";
}

/**
 * Resolve a validated frontend × backend × feature identity to either a
 * runnable iframe destination or an explicit, user-visible failure state.
 */
export function resolveShowcaseCell(
  input: ResolveShowcaseCellInput,
): ShowcaseCellResolution {
  const frontend = frontendById.get(input.frontend);
  if (!frontend || !frontend.runnable) {
    return {
      kind: "malformed",
      reason: `Unknown runnable Showcase frontend ${JSON.stringify(input.frontend)}.`,
    };
  }

  const integration = getIntegration(input.integration);
  if (!integration) {
    return {
      kind: "malformed",
      reason: `Unknown Showcase integration ${JSON.stringify(input.integration)}.`,
    };
  }

  const feature = getFeature(input.feature);
  if (!feature) {
    return {
      kind: "malformed",
      reason: `Unknown Showcase feature ${JSON.stringify(input.feature)}.`,
    };
  }

  const cellId = `${frontend.id}/${integration.slug}/${feature.id}`;
  const cell = cellById.get(cellId);
  if (!cell) {
    return {
      kind: "malformed",
      reason: `Showcase cell ${JSON.stringify(cellId)} is not declared.`,
    };
  }

  const common = {
    cellId,
    frontend,
    integrationName: integration.name,
    featureName: feature.name,
  };

  if (cell.frontend_status !== "supported") {
    return {
      ...common,
      kind: cell.frontend_status,
      reason: unavailableReason(cell),
      exception: cell.exception,
    };
  }

  if (cell.backend_status !== "wired" || !cell.runnable) {
    return {
      ...common,
      kind: "backend-unavailable",
      reason: unavailableReason(cell),
      exception: cell.exception,
    };
  }

  const demo = getDemo(integration.slug, feature.id)?.demo;
  if (!demo?.route) {
    return {
      ...common,
      kind: "backend-unavailable",
      reason: `This backend does not declare a runnable route for ${feature.name}.`,
      exception: null,
    };
  }

  if (frontend.id === "angular") {
    const angularHostUrl = input.angularHostUrl
      ? normalizedAngularHostUrl(input.angularHostUrl)
      : undefined;
    if (!angularHostUrl) {
      return {
        ...common,
        kind: "unavailable",
        reason:
          "Angular demos are not enabled in this environment. No React fallback was used.",
        exception: null,
      };
    }
    return {
      ...common,
      kind: "runnable",
      iframeUrl: `${angularHostUrl}/${encodeURIComponent(integration.slug)}/${encodeURIComponent(feature.id)}`,
    };
  }

  return {
    ...common,
    kind: "runnable",
    iframeUrl: `${resolveBackendUrl(integration.slug, input.backendHostPattern)}${demo.route}`,
  };
}
