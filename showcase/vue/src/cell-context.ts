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

export interface VueRuntimeConfig {
  frontendId: "vue";
  integrationId: string;
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

const FEATURE_PATH_RE = /^\/vue\/([a-z0-9][a-z0-9-]*[a-z0-9])$/;
const SAFE_ID_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

/** Read the bounded, non-secret manifest staged by the integration image. */
export function readVueRuntimeConfig(): VueRuntimeConfig | undefined {
  const candidate = globalThis.__COPILOTKIT_SHOWCASE__;
  if (typeof candidate !== "object" || candidate === null) return undefined;

  const keys = Object.keys(candidate).sort();
  const frontendId = Reflect.get(candidate, "frontendId");
  const integrationId = Reflect.get(candidate, "integrationId");
  if (
    keys.length !== 2 ||
    keys[0] !== "frontendId" ||
    keys[1] !== "integrationId" ||
    frontendId !== "vue" ||
    typeof integrationId !== "string" ||
    !SAFE_ID_RE.test(integrationId)
  ) {
    return undefined;
  }

  return {
    frontendId: "vue",
    integrationId,
  };
}

/** Resolve the same-origin runtime route for the implemented Vue feature. */
export function runtimePathForFeature(feature: string): string | undefined {
  return feature === "agentic-chat" ? "/api/copilotkit" : undefined;
}

/** Resolve one exact Vue browser cell without decoding or accepting aliases. */
export function resolveBrowserCell(
  pathname: string,
  catalog: BrowserCellCatalog,
  runtimeConfig = readVueRuntimeConfig(),
): BrowserCellResolution {
  const match = FEATURE_PATH_RE.exec(pathname);
  if (!match) {
    return { kind: "malformed", reason: "The demo route is malformed." };
  }
  if (runtimeConfig === undefined) {
    return {
      kind: "malformed",
      reason: "The integration runtime manifest is missing or invalid.",
    };
  }

  const integration = runtimeConfig.integrationId;
  const feature = match[1];
  const cellId = `vue/${integration}/${feature}`;
  const cell = catalog.cells.find((candidate) => candidate.id === cellId);
  if (!cell) {
    return { kind: "malformed", reason: "The demo cell is not declared." };
  }
  if (
    cell.id !== cellId ||
    cell.frontend !== "vue" ||
    cell.integration !== integration ||
    cell.feature !== feature
  ) {
    return {
      kind: "malformed",
      reason: "The demo cell identity is inconsistent.",
    };
  }
  if (
    cell.frontend_status !== "supported" ||
    cell.backend_status !== "wired" ||
    !cell.runnable
  ) {
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
  const runtimeUrl = runtimePathForFeature(feature);
  if (runtimeUrl === undefined) {
    return {
      kind: "unavailable",
      cellId,
      integration,
      feature,
      reason: `Feature "${feature}" does not have a Vue runtime route.`,
    };
  }

  return {
    kind: "runnable",
    cellId,
    integration,
    feature,
    runtimeUrl,
  };
}
