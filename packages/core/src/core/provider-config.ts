import type { AbstractAgent } from "@ag-ui/client";
import {
  COPILOT_CLOUD_CHAT_URL,
  COPILOT_CLOUD_PUBLIC_API_KEY_HEADER,
  ɵanySchema,
} from "@copilotkit/shared";
import type { DebugConfig } from "@copilotkit/shared";
import type { CopilotRuntimeTransport, FrontendTool } from "../types";
import { ɵbuildHumanInTheLoopTool } from "./human-in-the-loop";
import type { ɵHumanInTheLoopRegistry } from "./human-in-the-loop";
import type { CopilotKitCoreErrorHandler } from "./core";
import type { CopilotKitHeadersSource } from "./header-source";
import type { LearningConfig } from "./learning-bridge";
import type { CopilotKitMessageFilter } from "./message-filter";

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

/**
 * @internal The default headers for a public key: the Copilot Cloud key
 * header, or none without a key. Adapters pass the result to
 * `ɵwithHeaderDefaults`. It depends only on the key, so adapters can memoize
 * it on the key.
 *
 * @example
 * ɵpublicKeyHeaderDefaults("ck_pub_…"); // { "X-CopilotCloud-Public-Api-Key": "ck_pub_…" }
 */
export function ɵpublicKeyHeaderDefaults(
  publicKey: string | undefined,
): Record<string, string> {
  return publicKey ? { [ɵCOPILOT_CLOUD_PUBLIC_API_KEY_HEADER]: publicKey } : {};
}

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
  const headerDefaults = ɵpublicKeyHeaderDefaults(publicKey);

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
/** @internal A provider array prop that must keep its identity. */
export type ɵStableArrayProp = keyof typeof ɵSTABLE_ARRAY_WARNINGS;

/**
 * @internal The warning for a provider array prop that changed after mount,
 * or `undefined` when the change is fine.
 *
 * `renderToolCalls` warns only when its shape changes (see
 * {@link ɵtoolRendererShapeChanged}), so new render closures for the same
 * tools are fine. Every other prop warns on a new array.
 *
 * @param prop - Which prop changed.
 * @param initial - The value at mount. `undefined` counts as an empty list.
 * @param next - The new value.
 *
 * @example
 * const warning = ɵstableArrayPropWarning("frontendTools", initial, next);
 * if (warning) console.error(warning);
 */
export function ɵstableArrayPropWarning(
  prop: ɵStableArrayProp,
  initial: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
): string | undefined {
  if (next === initial) return undefined;
  if (
    prop === "renderToolCalls" &&
    !ɵtoolRendererShapeChanged(
      (initial ?? []) as readonly ɵToolRendererShape[],
      (next ?? []) as readonly ɵToolRendererShape[],
    )
  ) {
    return undefined;
  }
  return ɵSTABLE_ARRAY_WARNINGS[prop];
}

/** @internal A tool-call renderer the provider builds from a tool. */
export interface ɵProviderToolRenderer<TRender> {
  name: string;
  args: unknown;
  render: TRender;
  agentId?: string;
}

// oxlint-disable-next-line typescript/no-explicit-any -- tools of any argument shape; a handler's `args` type is contravariant
type AnyFrontendTool = FrontendTool<any>;

/** @internal A provider `frontendTools` entry, with its framework render. */
export type ɵProviderFrontendTool<TRender> = AnyFrontendTool & {
  render?: TRender;
};

/** @internal A provider `humanInTheLoop` entry, with its framework render. */
export type ɵProviderHumanInTheLoop<THitlRender> = Omit<
  AnyFrontendTool,
  "handler" | "type"
> & {
  render?: THitlRender;
};

/** @internal The input of {@link ɵassembleProviderRegistry}. */
export interface ɵProviderRegistryInput<TRenderer, TRender, THitlRender> {
  /** The provider's `renderToolCalls`. They come first, unchanged. */
  renderToolCalls?: readonly TRenderer[];
  /** The provider's `frontendTools`. */
  frontendTools?: readonly ɵProviderFrontendTool<TRender>[];
  /** Tools a built-in feature adds, such as Open Generative UI. */
  builtInFrontendTools?: readonly ɵProviderFrontendTool<TRender>[];
  /** The provider's `humanInTheLoop`. */
  humanInTheLoop?: readonly ɵProviderHumanInTheLoop<THitlRender>[];
  /**
   * The registry that parks human-in-the-loop calls. Pass a getter when the
   * core does not exist yet.
   */
  humanInTheLoopRegistry:
    | ɵHumanInTheLoopRegistry
    | (() => ɵHumanInTheLoopRegistry);
  /**
   * Wrap a human-in-the-loop render into a tool-call render. The wrapper
   * passes `ɵhitlRenderProps(props, tool, registry())` to `render`.
   */
  wrapHumanInTheLoopRender: (
    render: THitlRender,
    tool: ɵProviderHumanInTheLoop<THitlRender>,
    registry: () => ɵHumanInTheLoopRegistry,
  ) => TRender;
}

/**
 * @internal Build the tool list and the tool-call renderer list of a
 * provider from its props.
 *
 * - Tools: `frontendTools`, then `builtInFrontendTools`, then one tool per
 *   `humanInTheLoop` entry (see `ɵbuildHumanInTheLoopTool`).
 * - Renderers: `renderToolCalls`, then one renderer per frontend tool with a
 *   `render`, then one per human-in-the-loop entry with a `render`. A tool
 *   renderer keeps the tool's `agentId`. A frontend tool without
 *   `parameters` gets a renderer only when it is the `"*"` wildcard, which
 *   then accepts any arguments.
 *
 * @example
 * const { tools, renderToolCalls } = ɵassembleProviderRegistry({
 *   renderToolCalls: props.renderToolCalls,
 *   frontendTools: props.frontendTools,
 *   humanInTheLoop: props.humanInTheLoop,
 *   humanInTheLoopRegistry: () => core.ɵhumanInTheLoop,
 *   wrapHumanInTheLoopRender: (Render, tool, registry) => (props) =>
 *     <Render {...ɵhitlRenderProps(props, tool, registry())} />,
 * });
 */
export function ɵassembleProviderRegistry<TRenderer, TRender, THitlRender>(
  input: ɵProviderRegistryInput<TRenderer, TRender, THitlRender>,
): {
  tools: FrontendTool[];
  renderToolCalls: Array<TRenderer | ɵProviderToolRenderer<TRender>>;
} {
  const humanInTheLoop = ɵassembleHumanInTheLoop(input);
  return {
    tools: ɵassembleProviderTools({ ...input, humanInTheLoop }),
    renderToolCalls: ɵassembleProviderToolRenderers({
      ...input,
      humanInTheLoop,
    }),
  };
}

/** @internal The tools and renderers that a provider's `humanInTheLoop` gives. */
export interface ɵAssembledHumanInTheLoop<TRender> {
  tools: FrontendTool[];
  renderToolCalls: ɵProviderToolRenderer<TRender>[];
}

/**
 * @internal The human-in-the-loop part of {@link ɵassembleProviderRegistry}:
 * one tool per `humanInTheLoop` entry, and one renderer per entry with a
 * `render`.
 *
 * Each call wraps every render again, and a new wrapper is a new component
 * type to React and Vue, so the card remounts. Adapters memoize this result
 * on `humanInTheLoop` alone, and pass it to {@link ɵassembleProviderTools}
 * and {@link ɵassembleProviderToolRenderers}.
 */
export function ɵassembleHumanInTheLoop<TRender, THitlRender>(
  input: Pick<
    ɵProviderRegistryInput<unknown, TRender, THitlRender>,
    "humanInTheLoop" | "humanInTheLoopRegistry" | "wrapHumanInTheLoopRender"
  >,
): ɵAssembledHumanInTheLoop<TRender> {
  const registryInput = input.humanInTheLoopRegistry;
  const registry =
    typeof registryInput === "function" ? registryInput : () => registryInput;
  const tools: FrontendTool[] = [];
  const renderToolCalls: ɵProviderToolRenderer<TRender>[] = [];
  for (const entry of input.humanInTheLoop ?? []) {
    const { render, ...config } = entry;
    tools.push(ɵbuildHumanInTheLoopTool(config, registry));
    if (!render) continue;
    renderToolCalls.push({
      name: entry.name,
      args: entry.parameters,
      render: input.wrapHumanInTheLoopRender(render, entry, registry),
      ...(entry.agentId && { agentId: entry.agentId }),
    });
  }
  return { tools, renderToolCalls };
}

/**
 * @internal The tool list of {@link ɵassembleProviderRegistry}:
 * `frontendTools`, then `builtInFrontendTools`, then the human-in-the-loop
 * tools. It does not read `renderToolCalls`.
 */
export function ɵassembleProviderTools(input: {
  frontendTools?: readonly AnyFrontendTool[];
  builtInFrontendTools?: readonly AnyFrontendTool[];
  humanInTheLoop: Pick<ɵAssembledHumanInTheLoop<unknown>, "tools">;
}): FrontendTool[] {
  return [
    ...(input.frontendTools ?? []),
    ...(input.builtInFrontendTools ?? []),
    ...input.humanInTheLoop.tools,
  ];
}

/**
 * @internal The renderer list of {@link ɵassembleProviderRegistry}:
 * `renderToolCalls`, then one renderer per frontend tool with a `render`,
 * then the human-in-the-loop renderers, which keep their identity.
 */
export function ɵassembleProviderToolRenderers<TRenderer, TRender>(input: {
  renderToolCalls?: readonly TRenderer[];
  frontendTools?: readonly ɵProviderFrontendTool<TRender>[];
  builtInFrontendTools?: readonly ɵProviderFrontendTool<TRender>[];
  humanInTheLoop: Pick<ɵAssembledHumanInTheLoop<TRender>, "renderToolCalls">;
}): Array<TRenderer | ɵProviderToolRenderer<TRender>> {
  const renderToolCalls: Array<TRenderer | ɵProviderToolRenderer<TRender>> = [
    ...(input.renderToolCalls ?? []),
  ];
  for (const tool of [
    ...(input.frontendTools ?? []),
    ...(input.builtInFrontendTools ?? []),
  ]) {
    if (!tool.render) continue;
    const args =
      tool.parameters ?? (tool.name === "*" ? ɵanySchema : undefined);
    if (!args) continue;
    renderToolCalls.push({
      name: tool.name,
      args,
      render: tool.render,
      ...(tool.agentId && { agentId: tool.agentId }),
    });
  }
  renderToolCalls.push(...input.humanInTheLoop.renderToolCalls);
  return renderToolCalls;
}

/** @internal The input of {@link ɵresolveA2UIActivation}. */
export interface ɵA2UIActivationInput {
  /** The runtime reports `a2uiEnabled`. */
  runtimeEnabled: boolean;
  /** The provider has an `a2ui.catalog`. */
  hasCatalog: boolean;
  /**
   * Keep A2UI off without a catalog, even when the runtime enables it.
   * Angular sets it: it has no default catalog to render surfaces with.
   */
  requireCatalog?: boolean;
}

/**
 * @internal Whether the provider turns on A2UI: its built-in renderers and
 * its agent context.
 *
 * A2UI is active when the runtime enables it or the provider has a catalog.
 * With `requireCatalog`, only a catalog turns it on. `missingCatalog` is
 * true when the runtime enables A2UI but `requireCatalog` keeps it off;
 * the provider should tell the developer to configure a catalog.
 *
 * @example
 * ɵresolveA2UIActivation({ runtimeEnabled: true, hasCatalog: false });
 * // { active: true, missingCatalog: false }
 * ɵresolveA2UIActivation({ runtimeEnabled: true, hasCatalog: false, requireCatalog: true });
 * // { active: false, missingCatalog: true }
 */
export function ɵresolveA2UIActivation({
  runtimeEnabled,
  hasCatalog,
  requireCatalog = false,
}: ɵA2UIActivationInput) {
  if (requireCatalog) {
    return {
      active: hasCatalog,
      missingCatalog: runtimeEnabled && !hasCatalog,
    };
  }
  return { active: runtimeEnabled || hasCatalog, missingCatalog: false };
}

/** @internal The input of {@link ɵassembleActivityRenderers}. */
export interface ɵActivityRenderersInput<R> {
  /** The app's activity renderers. They come first, so they win. */
  app?: readonly R[];
  /** The A2UI surface renderer, when A2UI is active. */
  a2ui?: R;
  /** The other built-in renderers, in order. */
  builtIns?: readonly (R | undefined | false)[];
}

/**
 * @internal The provider's activity renderer list: the app's renderers, then
 * the A2UI renderer, then the other built-in renderers. Missing entries are
 * left out.
 *
 * @example
 * ɵassembleActivityRenderers({
 *   app: props.renderActivityMessages,
 *   a2ui: a2uiActive ? a2uiRenderer : undefined,
 *   builtIns: [mcpAppsRenderer, openGenUIActive && openGenUIRenderer],
 * });
 */
export function ɵassembleActivityRenderers<R>({
  app = [],
  a2ui,
  builtIns = [],
}: ɵActivityRenderersInput<R>): R[] {
  const renderers = [...app];
  if (a2ui) renderers.push(a2ui);
  for (const renderer of builtIns) {
    if (renderer) renderers.push(renderer);
  }
  return renderers;
}

/** @internal The object form of the provider `learning` option. */
export type ɵCopilotKitLearningOptions = LearningConfig & {
  /**
   * Starts a Trajectory after mount. Defaults to `true`; set `false` to call
   * `startTrajectory()` yourself.
   */
  autoStart?: boolean;
  trajectoryId?: string;
  /**
   * Used only by explicit custom sinks. Authenticated capture warns and ignores
   * this option; assign Learning Spaces on the server with
   * `getTrajectoryLearningContainerIds` on `CopilotKitIntelligence`.
   */
  learningContainerIds?: string[];
};

/** @internal The `a2ui` provider options every framework shares. */
export interface ɵA2UIBaseOptions {
  /**
   * When true (the default), the full component schemas from the catalog are
   * sent as agent context so the agent knows what components and props are
   * available. The A2UI middleware can overwrite this with a server-side
   * schema if configured.
   *
   * When false, the agent context still describes the catalog, but only by its
   * catalog ID and the names of its custom components, without their JSON
   * schemas. The component schema entry and the A2UI generation and design
   * guidelines are not sent. With the CopilotKit LangGraph middleware's
   * injected A2UI tool, the A2UI subagent then gets the component names only;
   * a host can still give it a composition guide through the middleware's
   * guidelines (`a2uiParams.guidelines.compositionGuide` in TypeScript,
   * `a2ui_params["guidelines"]["composition_guide"]` in Python).
   */
  includeSchema?: boolean;
}

/**
 * @internal The provider options that React, Vue and React Native share with
 * the same names. The framework props extend this type, so the docs live in
 * one place. Angular picks the options whose names match.
 */
export interface ɵCopilotKitProviderBaseOptions {
  /** The endpoint of your CopilotRuntime. */
  runtimeUrl?: string;
  /**
   * Headers sent with every request. A record, or a sync or async builder
   * that runs when each request is sent. An inline arrow is fine. The builder
   * should be cheap; cache tokens in it (Clerk's `getToken()` already does).
   */
  headers?: CopilotKitHeadersSource;
  /**
   * Credentials mode for fetch requests (e.g., "include" for HTTP-only cookies in cross-origin requests).
   */
  credentials?: RequestCredentials;
  /**
   * Rewrites the message list sent to runtime agents on every run.
   *
   * CopilotKit sends the whole thread each time. When your agent already
   * stores the conversation, most of that payload is waste, and an agent that
   * merges the inbound list with its own store can show the model every turn
   * twice. Return the messages to send:
   *
   * ```ts
   * messageFilter: (messages) => messages.slice(-1)
   * ```
   *
   * The filter changes the request body only. The transcript the UI renders is
   * untouched. Broken tool-call pairs are repaired before the request is sent,
   * so a filter this blunt cannot strand a tool result mid-HITL.
   *
   * Agents reached through your CopilotRuntime honor this. An agent your app
   * passes in directly does not, and neither Intelligence runs nor suggestion
   * runs are ever filtered.
   *
   * Prefer a stable function reference. A new function on every render
   * re-registers the filter, which is harmless but needless.
   */
  messageFilter?: CopilotKitMessageFilter;
  /** Your CopilotKit public license key. */
  publicApiKey?: string;
  /** Your public license key for accessing CopilotKit Intelligence features. */
  publicLicenseKey?: string;
  /**
   * Signed license token for offline verification of CopilotKit Intelligence features.
   * Obtain from https://dashboard.operations.copilotkit.ai.
   */
  licenseToken?: string;
  /** Properties sent as `forwardedProps` with every agent run. */
  properties?: Record<string, unknown>;
  /**
   * `true` uses the single-route runtime transport, `false` the REST
   * transport. Omit it to detect the transport from the runtime.
   */
  useSingleEndpoint?: boolean;
  /** Local agents, keyed by id. For development only; production uses CopilotRuntime. */
  agents__unsafe_dev_only?: Record<string, AbstractAgent>;
  /**
   * Agents you host yourself, keyed by id. Part of the Enterprise
   * Intelligence tier: set `publicLicenseKey` for production use.
   */
  selfManagedAgents?: Record<string, AbstractAgent>;
  /**
   * Error handler called when CopilotKit encounters an error.
   * Fires for all error types (runtime connection failures, agent errors, tool errors).
   * Without a handler, errors are logged with `console.error`.
   */
  onError?: CopilotKitCoreErrorHandler;
  /**
   * Default throttle interval (in milliseconds) for agent re-renders
   * triggered by `OnMessagesChanged` notifications. This value is used as
   * a fallback when neither the agent hook nor the chat component
   * specifies an explicit `throttleMs`.
   *
   * @default undefined (no throttling)
   */
  defaultThrottleMs?: number;
  /**
   * Enable debug logging for the client-side event pipeline.
   *
   * Accepts:
   * - `true` / `false` to toggle events + lifecycle logging (verbose off).
   * - `{ events?: boolean; lifecycle?: boolean; verbose?: boolean }` for granular control.
   */
  debug?: DebugConfig;
  /** Configuration for the built-in MCP Apps renderer. */
  mcpApps?: {
    /**
     * Restore `allow-same-origin` on the MCP App sandbox. Default `false`.
     *
     * **Unsafe.** The widget then runs with your page's origin: it can read
     * your cookies, storage and DOM, and call your APIs as the signed-in user.
     * Only set it for widgets you wrote and trust that need `localStorage`,
     * `IndexedDB` or cookies. By default widgets get an opaque origin.
     */
    allowSameOriginFallback?: boolean;
  };
  /**
   * Turns on interaction capture (`@copilotkit/learning`). `true` records
   * with the default options; pass an object for options. `false` or
   * omitting the option turns capture off and cancels startup. Without a
   * sink, Core authenticates with the runtime and sends browser events to
   * Intelligence; a custom sink keeps the standalone collector behavior.
   * Updated settings apply to the next Trajectory.
   *
   * Capture starts after mount. Set `trajectoryId` to use your own ID;
   * otherwise the provider generates one. The generated ID stays the same
   * across rerenders, reconnects and option changes; turning capture off,
   * setting `autoStart: false` or supplying a `trajectoryId` ends it, and the
   * next generated Trajectory gets a new ID. Read the active ID from
   * `copilotkit.trajectoryId`.
   *
   * Set `autoStart: false` to start capture yourself with `startTrajectory()`.
   * Capture stops on unmount, including manually started Trajectories.
   */
  learning?: boolean | ɵCopilotKitLearningOptions;
}
