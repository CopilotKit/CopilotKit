import type { AbstractAgent } from "@ag-ui/client";
import {
  COPILOT_CLOUD_CHAT_URL,
  COPILOT_CLOUD_PUBLIC_API_KEY_HEADER,
} from "@copilotkit/shared";
import type { CopilotRuntimeTransport } from "../types";

/**
 * @internal The header that carries the Copilot Cloud public API key. Every
 * framework provider adds it to the request headers when a key is set.
 */
export const ɵCOPILOT_CLOUD_PUBLIC_API_KEY_HEADER =
  COPILOT_CLOUD_PUBLIC_API_KEY_HEADER;

/**
 * @internal The Copilot Cloud runtime URL. Providers use it when a public key
 * is set and no `runtimeUrl` is given.
 */
export const ɵCOPILOT_CLOUD_RUNTIME_URL = COPILOT_CLOUD_CHAT_URL;

/** @internal The framework-neutral provider inputs that need normalizing. */
export interface ɵProviderConfigInput {
  runtimeUrl?: string;
  /** `publicApiKey` in React and Vue, `licenseKey` in Angular. */
  publicApiKey?: string;
  publicLicenseKey?: string;
  /** Maps to a transport when `runtimeTransport` is not set. */
  useSingleEndpoint?: boolean;
  /** Wins over `useSingleEndpoint`. */
  runtimeTransport?: CopilotRuntimeTransport;
  /** `agents__unsafe_dev_only` in React and Vue, `agents` in Angular. */
  agents__unsafe_dev_only?: Readonly<Record<string, AbstractAgent>>;
  selfManagedAgents?: Readonly<Record<string, AbstractAgent>>;
  properties?: Record<string, unknown>;
  /** The `a2ui.catalog` option. Any truthy value counts as a catalog. */
  a2uiCatalog?: unknown;
}

/** @internal Codes of the problems {@link ɵresolveProviderConfig} reports. */
export type ɵProviderConfigDiagnosticCode =
  | "missing_runtime_config"
  | "self_managed_agents_without_license";

/**
 * @internal A problem with the provider config. An `"error"` makes the
 * provider throw in production and warn otherwise. A `"warn"` always warns.
 */
export interface ɵProviderConfigDiagnostic {
  level: "error" | "warn";
  code: ɵProviderConfigDiagnosticCode;
  message: string;
}

const EMPTY_PROPERTIES: Readonly<Record<string, unknown>> = Object.freeze({});

const MISSING_RUNTIME_CONFIG_MESSAGE =
  "Missing required prop: 'runtimeUrl' or 'publicApiKey' or 'publicLicenseKey'";

const SELF_MANAGED_AGENTS_WITHOUT_LICENSE_MESSAGE =
  "[CopilotKit] `selfManagedAgents` is part of CopilotKit's Enterprise " +
  "Intelligence tier. Provide a `publicLicenseKey` for production " +
  "use — contact the CopilotKit team about licensing.";

function toRuntimeTransport(
  runtimeTransport: CopilotRuntimeTransport | undefined,
  useSingleEndpoint: boolean | undefined,
) {
  if (runtimeTransport !== undefined) return runtimeTransport;
  if (useSingleEndpoint === true) return "single";
  if (useSingleEndpoint === false) return "rest";
  return "auto";
}

/**
 * @internal Turn provider options into the values `CopilotKitCore` takes.
 *
 * - The public key is `publicApiKey`, else `publicLicenseKey`.
 * - The runtime URL is `runtimeUrl`, else Copilot Cloud when a key is set.
 * - The transport is `runtimeTransport`, else `useSingleEndpoint` mapped to
 *   `"single"` (true), `"rest"` (false) or `"auto"` (unset).
 * - The agents are the dev agents with `selfManagedAgents` on top.
 * - The properties get `a2uiCatalogAvailable: true` when a catalog is set.
 *   Without a catalog the input object is returned as is.
 * - The header defaults carry the public key header when a key is set.
 *
 * It does not log or throw. The provider reports `diagnostics` (see
 * {@link ɵreportProviderConfigDiagnostics}).
 *
 * @example
 * const resolved = ɵresolveProviderConfig({ publicApiKey: "ck_pub_…" });
 * resolved.runtimeUrl; // the Copilot Cloud URL
 */
export function ɵresolveProviderConfig(input: ɵProviderConfigInput) {
  const publicKey = input.publicApiKey ?? input.publicLicenseKey;
  const agents = {
    ...input.agents__unsafe_dev_only,
    ...input.selfManagedAgents,
  };
  const baseProperties = input.properties ?? EMPTY_PROPERTIES;
  const properties = input.a2uiCatalog
    ? { ...baseProperties, a2uiCatalogAvailable: true }
    : baseProperties;
  const headerDefaults: Record<string, string> = publicKey
    ? { [ɵCOPILOT_CLOUD_PUBLIC_API_KEY_HEADER]: publicKey }
    : {};

  const diagnostics: ɵProviderConfigDiagnostic[] = [];
  const hasLocalAgents = Object.keys(agents).length > 0;
  if (!input.runtimeUrl && !publicKey && !hasLocalAgents) {
    diagnostics.push({
      level: "error",
      code: "missing_runtime_config",
      message: MISSING_RUNTIME_CONFIG_MESSAGE,
    });
  }
  // `selfManagedAgents` is part of the Enterprise Intelligence tier. The check
  // is advisory and client-side only. `agents__unsafe_dev_only` is the free
  // local-dev escape hatch and is not checked.
  const hasSelfManagedAgents =
    Object.keys(input.selfManagedAgents ?? {}).length > 0;
  if (hasSelfManagedAgents && !publicKey) {
    diagnostics.push({
      level: "warn",
      code: "self_managed_agents_without_license",
      message: SELF_MANAGED_AGENTS_WITHOUT_LICENSE_MESSAGE,
    });
  }

  return {
    publicKey,
    runtimeUrl:
      input.runtimeUrl ?? (publicKey ? ɵCOPILOT_CLOUD_RUNTIME_URL : undefined),
    runtimeTransport: toRuntimeTransport(
      input.runtimeTransport,
      input.useSingleEndpoint,
    ),
    agents,
    properties,
    headerDefaults,
    diagnostics,
  };
}

/** @internal The result of {@link ɵresolveProviderConfig}. */
export type ɵResolvedProviderConfig = ReturnType<typeof ɵresolveProviderConfig>;

/** @internal Options for {@link ɵreportProviderConfigDiagnostics}. */
export interface ɵReportProviderConfigDiagnosticsOptions {
  /** When true, an `"error"` diagnostic throws instead of warning. */
  isProduction: boolean;
  /**
   * Messages already logged by this provider. Each message is logged once.
   * Keep one set per provider instance.
   */
  logged: Set<string>;
}

/**
 * @internal Report provider config diagnostics: throw the first `"error"` in
 * production, and otherwise `console.warn` each message once per `logged` set.
 *
 * @throws Error with the diagnostic message for an `"error"` in production.
 *
 * @example
 * const logged = new Set<string>();
 * ɵreportProviderConfigDiagnostics(resolved.diagnostics, {
 *   isProduction: process.env.NODE_ENV === "production",
 *   logged,
 * });
 */
export function ɵreportProviderConfigDiagnostics(
  diagnostics: readonly ɵProviderConfigDiagnostic[],
  { isProduction, logged }: ɵReportProviderConfigDiagnosticsOptions,
) {
  for (const diagnostic of diagnostics) {
    if (diagnostic.level === "error" && isProduction) {
      throw new Error(diagnostic.message);
    }
    if (logged.has(diagnostic.message)) continue;
    logged.add(diagnostic.message);
    console.warn(diagnostic.message);
  }
}

/** @internal Messages for provider array props that must keep their identity. */
export const ɵSTABLE_ARRAY_WARNINGS = Object.freeze({
  renderToolCalls:
    "renderToolCalls must be a stable array. If you want to dynamically add or remove tools, use `useFrontendTool` instead.",
  frontendTools:
    "frontendTools must be a stable array. If you want to dynamically add or remove tools, use `useFrontendTool` instead.",
  humanInTheLoop:
    "humanInTheLoop must be a stable array. If you want to dynamically add or remove human-in-the-loop tools, use `useHumanInTheLoop` instead.",
  renderCustomMessages: "renderCustomMessages must be a stable array.",
  renderActivityMessages: "renderActivityMessages must be a stable array.",
  sandboxFunctions: "openGenerativeUI.sandboxFunctions must be a stable array.",
});

/** @internal The parts of a tool call renderer that make up its shape. */
export interface ɵToolRendererShape {
  name?: string;
  agentId?: string;
}

function toolRendererKeys(renderers: readonly ɵToolRendererShape[]) {
  return new Set(
    renderers.map(
      (renderer) => `${renderer.agentId ?? ""}:${renderer.name ?? ""}`,
    ),
  );
}

/**
 * @internal Whether two `renderToolCalls` lists differ in shape: the set of
 * `agentId:name` pairs. A new array with the same pairs (for example new
 * render closures) is not a shape change, so it does not warn.
 *
 * @example
 * ɵtoolRendererShapeChanged([{ name: "a" }], [{ name: "a" }]); // false
 * ɵtoolRendererShapeChanged([{ name: "a" }], [{ name: "b" }]); // true
 */
export function ɵtoolRendererShapeChanged(
  previous: readonly ɵToolRendererShape[],
  next: readonly ɵToolRendererShape[],
) {
  const previousKeys = toolRendererKeys(previous);
  const nextKeys = toolRendererKeys(next);
  if (previousKeys.size !== nextKeys.size) return true;
  for (const key of previousKeys) {
    if (!nextKeys.has(key)) return true;
  }
  return false;
}
