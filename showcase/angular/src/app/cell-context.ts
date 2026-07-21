export interface BrowserCellCatalog {
  cells: Array<{
    id: string;
    frontend: string;
    integration: string;
    feature: string;
    frontend_status: string;
    backend_status: string;
    runnable: boolean;
    exception: { reason: string } | null;
  }>;
}

export type BrowserCellResolution =
  | {
      kind: "runnable";
      cellId: string;
      integration: string;
      feature: string;
      runtimeUrl: string;
    }
  | {
      kind: "unavailable";
      cellId: string;
      integration: string;
      feature: string;
      reason: string;
    }
  | { kind: "malformed"; reason: string };

const CELL_PATH_RE =
  /^\/([a-z0-9][a-z0-9-]*[a-z0-9])\/([a-z0-9][a-z0-9-]*[a-z0-9])\/?$/;

/** Resolve a browser pathname without decoding or accepting extra segments. */
export function resolveBrowserCell(
  pathname: string,
  catalog: BrowserCellCatalog,
): BrowserCellResolution {
  const match = CELL_PATH_RE.exec(pathname);
  if (!match) {
    return { kind: "malformed", reason: "The demo route is malformed." };
  }
  const integration = match[1];
  const feature = match[2];
  const cellId = `angular/${integration}/${feature}`;
  const cell = catalog.cells.find((candidate) => candidate.id === cellId);
  if (!cell) {
    return { kind: "malformed", reason: "The demo cell is not declared." };
  }
  if (!cell.runnable) {
    return {
      kind: "unavailable",
      cellId,
      integration,
      feature,
      reason:
        cell.exception?.reason ??
        `This ${cell.frontend_status} frontend and ${cell.backend_status} backend intersection is not runnable.`,
    };
  }
  return {
    kind: "runnable",
    cellId,
    integration,
    feature,
    runtimeUrl: `/api/copilotkit/${integration}/${feature}`,
  };
}

/** Report whether one exact frontend/backend/feature cell may load demo code. */
export function isRunnableBrowserCell(
  integration: string,
  feature: string,
  catalog: BrowserCellCatalog,
): boolean {
  return (
    resolveBrowserCell(`/${integration}/${feature}`, catalog).kind ===
    "runnable"
  );
}
