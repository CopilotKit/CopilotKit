import type {
  FrontendRegistry,
  FrontendSupportDeclaration,
  FrontendSupportState,
} from "./frontend-registry.js";

export interface BackendCatalogCell {
  id: string;
  integration: string;
  feature: string | null;
  status: "wired" | "stub" | "unshipped" | "unsupported";
}

export interface FrontendCatalogException {
  reason: string;
  owner: string;
  review_date: string;
  issue?: string;
}

export interface FrontendCatalogRevisionIdentity {
  source_commit: string;
  container_image_revision: string;
  fixture_revision: string;
}

export interface FrontendCatalogCell {
  id: string;
  frontend: string;
  integration: string;
  feature: string;
  frontend_status: FrontendSupportState;
  backend_status: BackendCatalogCell["status"];
  demo_route: string;
  fixture_identity: string;
  source_commit: string;
  container_image_revision: string;
  fixture_revision: string;
  runnable: boolean;
  exception: FrontendCatalogException | null;
}

export interface FrontendCatalog {
  metadata: {
    total_cells: number;
    runnable: number;
    docs_only: number;
    not_supported: number;
    not_applicable: number;
    quarantined: number;
    backend_unavailable: number;
  };
  cells: FrontendCatalogCell[];
}

function exceptionFrom(
  declaration: FrontendSupportDeclaration,
): FrontendCatalogException | null {
  if (
    declaration.state !== "not-supported" &&
    declaration.state !== "not-applicable" &&
    declaration.state !== "quarantined"
  ) {
    return null;
  }

  return {
    reason: declaration.reason!,
    owner: declaration.owner!,
    review_date: declaration.review_date!,
    ...(declaration.issue === undefined ? {} : { issue: declaration.issue }),
  };
}

/** Generate the frontend × backend × feature Showcase catalog. */
export function generateFrontendCatalog(
  frontendRegistry: FrontendRegistry,
  backendCells: readonly BackendCatalogCell[],
  revisions: FrontendCatalogRevisionIdentity,
): FrontendCatalog {
  const frontends = frontendRegistry.frontends.filter(
    (frontend) => frontend.feature_support_required,
  );
  const cells: FrontendCatalogCell[] = [];

  for (const backendCell of backendCells) {
    if (
      backendCell.feature === null ||
      !(backendCell.feature in frontendRegistry.feature_support)
    ) {
      continue;
    }

    for (const frontend of frontends) {
      const declaration =
        frontendRegistry.feature_support[backendCell.feature][frontend.id];
      if (declaration === undefined) {
        throw new Error(
          `feature "${backendCell.feature}" is missing required frontend ` +
            `"${frontend.id}"`,
        );
      }
      cells.push({
        id: `${frontend.id}/${backendCell.id}`,
        frontend: frontend.id,
        integration: backendCell.integration,
        feature: backendCell.feature,
        frontend_status: declaration.state,
        backend_status: backendCell.status,
        demo_route:
          frontend.id === "angular"
            ? `/angular/${backendCell.feature}`
            : `/demos/${backendCell.feature}`,
        fixture_identity: backendCell.id,
        ...revisions,
        runnable:
          declaration.state === "supported" && backendCell.status === "wired",
        exception: exceptionFrom(declaration),
      });
    }
  }

  return {
    metadata: {
      total_cells: cells.length,
      runnable: cells.filter((cell) => cell.runnable).length,
      docs_only: cells.filter((cell) => cell.frontend_status === "docs-only")
        .length,
      not_supported: cells.filter(
        (cell) => cell.frontend_status === "not-supported",
      ).length,
      not_applicable: cells.filter(
        (cell) => cell.frontend_status === "not-applicable",
      ).length,
      quarantined: cells.filter(
        (cell) => cell.frontend_status === "quarantined",
      ).length,
      backend_unavailable: cells.filter(
        (cell) =>
          cell.frontend_status === "supported" &&
          cell.backend_status !== "wired",
      ).length,
    },
    cells,
  };
}
