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

export interface AngularRuntimeConfig {
  frontendId: "angular";
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

const FEATURE_PATH_RE = /^\/angular\/([a-z0-9][a-z0-9-]*[a-z0-9])\/?$/;
const SAFE_ID_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

/** Read the bounded, non-secret manifest staged by the integration image. */
export function readAngularRuntimeConfig(): AngularRuntimeConfig | undefined {
  const candidate = (
    globalThis as typeof globalThis & {
      __COPILOTKIT_SHOWCASE__?: unknown;
    }
  ).__COPILOTKIT_SHOWCASE__;
  if (typeof candidate !== "object" || candidate === null) return undefined;
  const manifest = candidate as Record<string, unknown>;
  const keys = Object.keys(manifest).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "frontendId" ||
    keys[1] !== "integrationId" ||
    manifest["frontendId"] !== "angular" ||
    typeof manifest["integrationId"] !== "string" ||
    !SAFE_ID_RE.test(manifest["integrationId"])
  ) {
    return undefined;
  }
  return {
    frontendId: "angular",
    integrationId: manifest["integrationId"],
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

const INTEGRATION_RUNTIME_PATHS: Readonly<Record<string, string>> = {
  // The in-process BuiltIn runtime intentionally serves these demos from
  // different endpoints than the external-agent integrations.
  "built-in-agent/beautiful-chat": "/api/copilotkit",
  "built-in-agent/headless-complete": "/api/copilotkit",
  "built-in-agent/reasoning-custom": "/api/copilotkit-reasoning",
  "built-in-agent/reasoning-default": "/api/copilotkit-reasoning",
  "built-in-agent/tool-rendering-reasoning-chain": "/api/copilotkit-reasoning",
};

/** Resolve the existing same-origin runtime route for one feature. */
export function runtimePathForFeature(
  feature: string,
  integration?: string,
): string {
  return (
    (integration === undefined
      ? undefined
      : INTEGRATION_RUNTIME_PATHS[`${integration}/${feature}`]) ??
    RUNTIME_PATHS[feature] ??
    "/api/copilotkit"
  );
}

/** Resolve a browser pathname without decoding or accepting extra segments. */
export function resolveBrowserCell(
  pathname: string,
  catalog: BrowserCellCatalog,
  runtimeConfig = readAngularRuntimeConfig(),
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
    runtimeUrl: runtimePathForFeature(feature, integration),
  };
}

/** Report whether one exact frontend/backend/feature cell may load demo code. */
export function isRunnableBrowserCell(
  integration: string,
  feature: string,
  catalog: BrowserCellCatalog,
): boolean {
  return (
    resolveBrowserCell(`/angular/${feature}`, catalog, {
      frontendId: "angular",
      integrationId: integration,
    }).kind === "runnable"
  );
}

/** Keep unknown tool disclosure opt-in and scoped to its dedicated demo. */
export function isDefaultToolRenderingCell(feature: string): boolean {
  return feature === "tool-rendering-default-catchall";
}
