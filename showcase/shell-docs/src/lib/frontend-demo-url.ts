export interface FrontendDemoCell {
  frontend: string;
  integration: string;
  feature: string;
  demo_route: string;
  runnable: boolean;
}

export type FrontendDemoUrlResolution =
  | { kind: "catalog"; url: string; cell: FrontendDemoCell }
  | { kind: "unsupported"; cell: FrontendDemoCell }
  | { kind: "fallback"; url: string };

/**
 * Resolve an inline demo through the selected frontend's generated catalog
 * cell. A legacy backend demo URL is retained only when no cell exists.
 */
export function resolveFrontendDemoUrl({
  frontend,
  integration,
  feature,
  backendUrl,
  catalogCells,
}: {
  frontend?: string;
  integration: string;
  feature: string;
  backendUrl: string;
  catalogCells: readonly FrontendDemoCell[];
}): FrontendDemoUrlResolution {
  const cell = frontend
    ? catalogCells.find(
        (candidate) =>
          candidate.frontend === frontend &&
          candidate.integration === integration &&
          candidate.feature === feature,
      )
    : undefined;

  if (cell) {
    if (!cell.runnable || !cell.demo_route.startsWith("/")) {
      return { kind: "unsupported", cell };
    }
    return {
      kind: "catalog",
      cell,
      url: `${backendUrl.replace(/\/$/, "")}${cell.demo_route}`,
    };
  }

  return {
    kind: "fallback",
    url: `${backendUrl.replace(/\/$/, "")}/demos/${feature}`,
  };
}
