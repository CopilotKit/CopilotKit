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

const RUNTIME_PATHS: Readonly<Record<string, string>> = {
  "a2ui-fixed-schema": "/api/copilotkit-a2ui-fixed-schema",
  "a2ui-recovery": "/api/copilotkit-a2ui-recovery",
  "agent-config": "/api/copilotkit-agent-config",
  auth: "/api/copilotkit-auth",
  "background-agents": "/api/copilotkit-background-agents",
  "beautiful-chat": "/api/copilotkit-beautiful-chat",
  "browser-use": "/api/copilotkit-browser-use",
  "declarative-gen-ui": "/api/copilotkit-declarative-gen-ui",
  "headless-complete": "/api/copilotkit-mcp-apps",
  "mcp-apps": "/api/copilotkit-mcp-apps",
  multimodal: "/api/copilotkit-multimodal",
  "observational-memory": "/api/copilotkit-observational-memory",
  "open-gen-ui": "/api/copilotkit-ogui",
  "open-gen-ui-advanced": "/api/copilotkit-ogui",
  voice: "/api/copilotkit-voice",
};

/** Resolve the existing same-origin runtime route for one feature. */
export function runtimePathForFeature(feature: string): string {
  return RUNTIME_PATHS[feature] ?? "/api/copilotkit";
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

  return {
    kind: "runnable",
    cellId,
    integration,
    feature,
    runtimeUrl: runtimePathForFeature(feature),
  };
}
