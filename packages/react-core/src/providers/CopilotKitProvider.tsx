"use client";

import type { AbstractAgent } from "@ag-ui/client";
import type {
  ɵA2UIBaseOptions,
  ɵCopilotKitProviderBaseOptions,
  ɵRuntimeInfo,
  ɵStableArrayProp,
} from "@copilotkit/core";
import {
  ɵLearningAutoStarter,
  ɵassembleActivityRenderers,
  ɵassembleHumanInTheLoop,
  ɵassembleProviderToolRenderers,
  ɵassembleProviderTools,
  ɵhitlRenderProps,
  ɵresolveA2UIActivation,
  ɵstableArrayPropWarning,
  ɵtoLearningConfig,
} from "@copilotkit/core";
import type React from "react";
import {
  createElement,
  useMemo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ɵuseOwnedCore } from "./use-owned-core";
import type { ReactNode } from "react";
// Context extracted to ../context.ts for cross-platform reuse (React Native)
import {
  CopilotKitAgentIdContext,
  CopilotKitContext,
  LicenseContext,
} from "../context";
import type { CopilotKitContextValue } from "../context";
export type { CopilotKitContextValue } from "../context";
export { CopilotKitContext, useLicenseContext } from "../context";
import { CopilotKitInspector } from "../components/CopilotKitInspector";
import { CopilotKitInspectorContextProvider } from "../components/CopilotKitInspectorContext";
import type { CopilotKitInspectorOpenRequest } from "../components/CopilotKitInspectorContext";
import { LicenseWarningBanner } from "../components/license-warning-banner";
import {
  ɵaddOpenGenerativeUIContexts,
  ɵcreateOpenGenerativeUITool,
  ɵisOpenGenerativeUIActive,
  ɵpublicKeyHeaderDefaults,
  ɵreportProviderConfigDiagnostics,
  ɵresolveLicenseState,
  ɵresolveProviderConfig,
  ɵwithHeaderDefaults,
} from "@copilotkit/core";
import {
  MCPAppsActivityContentSchema,
  MCPAppsActivityRenderer,
  MCPAppsActivityType,
} from "../components/MCPAppsActivityRenderer";
import {
  OpenGenerativeUIActivityType,
  OpenGenerativeUIContentSchema,
  OpenGenerativeUIActivityRenderer,
  OpenGenerativeUIToolRenderer,
} from "../components/OpenGenerativeUIRenderer";
import { createA2UIMessageRenderer } from "../a2ui/A2UIMessageRenderer";
import type { A2UIActionInterceptor } from "../a2ui/A2UIMessageRenderer";
import type { A2UIRecoveryRendererOptions } from "../a2ui/A2UIRecoveryStates";
import { A2UIBuiltInToolCallRenderer } from "../a2ui/A2UIToolCallRenderer";
import { useGenerativeUIRoot } from "../generative-ui/use-generative-ui-root";
import type { GenerativeUIConfig } from "../generative-ui/runtime-context";
import {
  createGenerativeUIActivityRenderer,
  createGenerativeUIFunctionCallActivityRenderer,
  GenerativeUIToolCallRenderer,
} from "../generative-ui/chat";
import { GenerativeUIRuntimeContext } from "../generative-ui/runtime-context";
import {
  viewerTheme,
  filterCatalog,
  Catalog,
  basicCatalog as a2uiBasicCatalog,
} from "@copilotkit/a2ui-renderer";
import { A2UICatalogController } from "@copilotkit/a2ui-renderer/catalog-schema";
import type { Theme as A2UITheme } from "@copilotkit/a2ui-renderer";
import { CopilotKitCoreReact } from "../lib/react-core";
import type {
  ReactActivityMessageRenderer,
  ReactToolCallRenderer,
} from "../types";
import type { ReactFrontendTool } from "../types/frontend-tool";
import type { ReactHumanInTheLoop } from "../types/human-in-the-loop";
import type { ReactCustomMessageRenderer } from "../types/react-custom-message-renderer";
import type { SandboxFunction } from "../types/sandbox-function";
import { SandboxFunctionsContext } from "./SandboxFunctionsContext";
import { MarkdownRendererProvider } from "./MarkdownRendererContext";
import type { MarkdownRenderer } from "./MarkdownRendererContext";
import { CopilotStyleOptionsProvider } from "../styles/copilot-kit-styles";
import { shouldEnableInspector } from "@copilotkit/shared";

// Stable frozen defaults keep provider effects from re-running just because a
// caller omitted an object prop on a rerender.
const EMPTY_HEADERS: Readonly<Record<string, string>> = Object.freeze({});
const EMPTY_PROPERTIES: Readonly<Record<string, unknown>> = Object.freeze({});
const EMPTY_AGENTS: Readonly<Record<string, AbstractAgent>> = Object.freeze({});

// Provider props interface
/** The MCP Apps renderer with `mcpApps.allowSameOriginFallback` applied. */
const SameOriginMCPAppsActivityRenderer: typeof MCPAppsActivityRenderer = (
  props,
) => <MCPAppsActivityRenderer {...props} allowSameOriginFallback />;

export interface CopilotKitProviderProps extends ɵCopilotKitProviderBaseOptions {
  children: ReactNode;
  /**
   * CSP nonce for the `<style>` tags CopilotKit adds. Set it when your
   * Content-Security-Policy limits `style-src` to a nonce.
   */
  nonce?: string;
  /**
   * Set to `false` when you import `@copilotkit/core/styles.css` yourself, so
   * browsers cache the CSS as a file. CopilotKit then adds no `<style>` tag.
   * @default true
   */
  injectStyles?: boolean;
  /**
   * The id of the agent every `<CopilotChat>` under this provider talks to,
   * unless a chat names its own with the `agentId` prop.
   *
   * This is the v2 replacement for the v1 `<CopilotKit agent="...">` prop. Set
   * it here and you never need the v1 compatibility provider just to name an
   * agent. Defaults to `"default"`.
   */
  agentId?: string;
  renderToolCalls?: ReactToolCallRenderer<any>[];
  renderActivityMessages?: ReactActivityMessageRenderer<any>[];
  renderCustomMessages?: ReactCustomMessageRenderer[];
  /**
   * Global markdown renderer used by assistant/reasoning messages. Overrides the
   * built-in basic renderer. A per-message `markdownRenderer` slot still wins
   * over this. Plug in your own (e.g. a streamdown wrapper) to restore rich
   * rendering — CopilotKit ships only the basic renderer.
   */
  markdownRenderer?: MarkdownRenderer;
  frontendTools?: ReactFrontendTool[];
  humanInTheLoop?: ReactHumanInTheLoop[];
  /**
   * Configuration for OpenGenerativeUI — sandboxed UI generated by the LLM.
   *
   * @example
   * ```tsx
   * <CopilotKitProvider
   *   runtimeUrl="/api/copilotkit"
   *   openGenerativeUI={{
   *     sandboxFunctions: [{ name: "addToCart", description: "…", parameters: schema, handler: fn }],
   *   }}
   * >
   * ```
   */
  openGenerativeUI?: {
    /**
     * Functions made available inside sandboxed iframes.
     * Each function is described to the LLM via agent context and exposed
     * via websandbox's `localApi`.
     *
     * Inside the iframe, call them with:
     * ```js
     * await Websandbox.connection.remote.<functionName>(args)
     * ```
     */
    sandboxFunctions?: SandboxFunction[];
    /**
     * Design guidelines injected as agent context for the `generateSandboxedUi` tool.
     * Override this to control the visual style of generated UIs.
     *
     * A sensible default is provided if omitted.
     */
    designSkill?: string;
  };
  /**
   * Disable the CopilotKit Inspector in development.
   * The Inspector is enabled by default in development browser builds on
   * localhost/loopback. It is always disabled on remote hosts, in production,
   * and during server rendering. Temporary Inspector hides also hide its
   * message shortcuts.
   * An explicit value takes priority over CopilotChat's inspectorTools prop.
   */
  enableInspector?: boolean;
  /**
   * Whether to automatically mount the Intelligence indicator in chat.
   *
   * @default true
   */
  showIntelligenceIndicator?: boolean;
  /**
   * Configuration for the A2UI (Agent-to-UI) renderer.
   * The built-in A2UI renderer is activated automatically when the runtime reports
   * that `a2ui` is configured in `CopilotRuntime`. This prop is optional and only
   * needed if you want to override the default theme.
   *
   * @example
   * ```tsx
   * <CopilotKitProvider runtimeUrl="/api/copilotkit" a2ui={{ theme: myCustomTheme }}>
   *   {children}
   * </CopilotKitProvider>
   * ```
   */
  a2ui?: ɵA2UIBaseOptions & {
    /**
     * Override the default A2UI viewer theme.
     * When omitted, the built-in `viewerTheme` from `@copilotkit/a2ui-renderer` is used.
     */
    theme?: A2UITheme;
    /**
     * Optional component catalog to pass to the A2UI renderer.
     * When omitted, the default basicCatalog is used.
     */
    catalog?: any;
    /**
     * Optional custom loading component shown while an A2UI surface is generating.
     * When omitted, a default animated skeleton is shown.
     */
    loadingComponent?: React.ComponentType;
    /**
     * Options for the A2UI error-recovery status UI (OSS-162): how long before
     * the transient "Retrying…" hint appears, after how many attempts, and how
     * much retry/debug detail to surface. When omitted, sane defaults apply.
     */
    recovery?: A2UIRecoveryRendererOptions;
    /**
     * Intercept A2UI user actions before they reach the agent: return `null`
     * to handle an action client-side (e.g. a `navigate` event), return an
     * action to forward that one instead, or return nothing to forward it
     * unchanged.
     */
    onAction?: A2UIActionInterceptor;
  };
  /**
   * Experimental. Native generative UI: `generativeUI={{ ui }}`, where `ui`
   * comes from `createGenerativeUI`. The agent renders your React components
   * into chat or into `<GenerativeUISurface id>` mounts. Props that match
   * the declared state and events that match the declared functions are
   * bound by the library, and the model does not see them.
   */
  generativeUI?: GenerativeUIConfig;
}

// Normalize an array prop to a stable reference, and warn (rule from core)
// when it changes after mount.
function useStableArrayProp<T>(
  prop: T[] | undefined,
  name: ɵStableArrayProp,
): T[] {
  const empty = useMemo<T[]>(() => [], []);
  const value = prop ?? empty;
  const initial = useRef(value);

  useEffect(() => {
    const warning = ɵstableArrayPropWarning(name, initial.current, value);
    if (warning) console.error(warning);
  }, [value, name]);

  return value;
}

/** Provide a shared core instance and synchronize runtime, tool, and UI configuration. */
export const CopilotKitProvider: React.FC<CopilotKitProviderProps> = ({
  children,
  runtimeUrl,
  headers: headersProp = EMPTY_HEADERS,
  credentials,
  nonce,
  injectStyles = true,
  messageFilter,
  publicApiKey,
  publicLicenseKey,
  properties = EMPTY_PROPERTIES,
  agents__unsafe_dev_only: agents = EMPTY_AGENTS,
  selfManagedAgents = EMPTY_AGENTS,
  renderToolCalls,
  renderActivityMessages,
  renderCustomMessages,
  markdownRenderer,
  frontendTools,
  humanInTheLoop,
  openGenerativeUI,
  enableInspector,
  agentId,
  showIntelligenceIndicator = true,
  useSingleEndpoint,
  onError,
  a2ui,
  generativeUI,
  mcpApps,
  defaultThrottleMs,
  debug,
  learning,
}) => {
  // Memoized so a stable `learning` object keeps a stable config after
  // `autoStart` is removed.
  const learningConfig = useMemo(() => ɵtoLearningConfig(learning), [learning]);

  // Keep the server render and the first client render identical. The
  // Inspector only runs in local development. Resolve its host and build
  // policy after hydration instead of branching on `window` during render.
  const [shouldRenderInspector, setShouldRenderInspector] = useState(false);
  const [inspectorVisible, setInspectorVisible] = useState(false);

  useEffect(() => {
    setShouldRenderInspector(
      shouldEnableInspector({
        enableInspector,
        isBrowser: true,
        isDevelopment: process.env.NODE_ENV === "development",
        hostname: window.location?.hostname,
      }),
    );
  }, [enableInspector]);

  const [inspectorOpenRequest, setInspectorOpenRequest] =
    useState<CopilotKitInspectorOpenRequest | null>(null);
  // Core's runtime info snapshot, projected once the core exists (see the
  // subscription effect below). `null` until the first sync.
  const [runtimeInfo, setRuntimeInfo] = useState<ɵRuntimeInfo | null>(null);
  const runtimeA2UIEnabled = runtimeInfo?.a2uiEnabled ?? false;
  const runtimeOpenGenUIEnabled = runtimeInfo?.openGenerativeUIEnabled ?? false;
  // Bumped by onCatalogComponentsChanged so the filtered catalog re-derives
  // when a component is enabled/disabled after mount.
  const [catalogToggleVersion, setCatalogToggleVersion] = useState(0);
  const openGenUIActive = ɵisOpenGenerativeUIActive({
    runtimeEnabled: runtimeOpenGenUIEnabled,
    configured: !!openGenerativeUI,
  });
  // A catalog passed to the provider is enough to turn A2UI on: render the
  // surfaces locally and forward the catalog signal so the runtime injects the
  // render tool — no runtime-side `a2ui` config required.
  const a2uiActive = ɵresolveA2UIActivation({
    runtimeEnabled: runtimeA2UIEnabled,
    hasCatalog: !!a2ui?.catalog,
  }).active;
  const generativeUIActive = !!generativeUI?.ui;
  const runtimeLicenseStatus = runtimeInfo?.licenseStatus;
  const runtimeEntitlements = runtimeInfo?.runtimeEntitlements;
  const runtimeEntitlementRetryPending =
    runtimeInfo?.runtimeEntitlementRetryPending ?? false;

  const requestInspectorOpen = useCallback(
    (request: CopilotKitInspectorOpenRequest) => {
      setInspectorOpenRequest({ ...request });
    },
    [],
  );

  const inspectorContextValue = useMemo(
    () => ({
      providerEnableInspector: enableInspector,
      isInspectorEnabled: shouldRenderInspector && inspectorVisible,
      openInspector: requestInspectorOpen,
    }),
    [
      enableInspector,
      shouldRenderInspector,
      inspectorVisible,
      requestInspectorOpen,
    ],
  );

  // Normalize array props to stable references with clear dev warnings
  // renderToolCalls warns only when its shape (names + agentId) changes, so
  // parents can pass updated closures (e.g., Storybook state).
  const renderToolCallsList = useStableArrayProp<ReactToolCallRenderer<any>>(
    renderToolCalls,
    "renderToolCalls",
  );

  const renderCustomMessagesList =
    useStableArrayProp<ReactCustomMessageRenderer>(
      renderCustomMessages,
      "renderCustomMessages",
    );

  const renderActivityMessagesList = useStableArrayProp<
    ReactActivityMessageRenderer<any>
  >(renderActivityMessages, "renderActivityMessages");

  // Stable core instance ref, declared here (before the activity-renderer memo)
  // so the filtered-catalog memo can read enablement off the current instance.
  // The instance itself is created in the ref-init block below; on the very
  // first render `current` is still null (nothing is disabled yet), so the
  // filtered catalog correctly equals the full catalog.
  const copilotkitRef = useRef<CopilotKitCoreReact | null>(null);

  // Raw catalog provided by the caller (typed loosely to match `a2ui.catalog?: any`).
  const rawCatalog = a2ui?.catalog as Catalog<any> | undefined;

  // Derive the FILTERED catalog for the render path: only components currently
  // enabled on core. Re-derives when enablement changes (catalogToggleVersion
  // bump from `a2uiCatalogController` below). The advertisement path is that
  // controller, which filters with the same `filterCatalog`, so a disabled
  // component vanishes from what the model sees AND what can paint.
  const filteredCatalog = useMemo(() => {
    if (!rawCatalog) return rawCatalog;
    // Only genuine `Catalog` instances are filtered (as the controller does). Callers may
    // also pass a minimal catalog-shaped object; only filter genuine instances.
    if (!(rawCatalog instanceof Catalog)) return rawCatalog;
    const core = copilotkitRef.current;
    return filterCatalog(rawCatalog, (name) =>
      core ? core.isCatalogComponentEnabled(name) : true,
    );
    // catalogToggleVersion forces re-derivation when enablement changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawCatalog, catalogToggleVersion]);

  const mcpAppsAllowSameOrigin = mcpApps?.allowSameOriginFallback === true;

  // The app's activity renderers, then the built-in ones (order from core).
  const allActivityRenderers = useMemo(
    () =>
      ɵassembleActivityRenderers<ReactActivityMessageRenderer<any>>({
        app: renderActivityMessagesList,
        // The a2ui-surface renderer owns the WHOLE generative-UI lifecycle
        // (OSS-162): building skeleton → retrying → hard-failure → painted
        // surface, all on one activity, swapped in place. `recovery` tunes the
        // pre-paint UX (timing + debug exposure); the server can override
        // debugExposure via the middleware.
        a2ui: a2uiActive
          ? createA2UIMessageRenderer({
              theme: a2ui?.theme ?? viewerTheme,
              catalog: filteredCatalog,
              loadingComponent: a2ui?.loadingComponent,
              recovery: a2ui?.recovery,
              onAction: a2ui?.onAction,
            })
          : undefined,
        builtIns: [
          {
            activityType: MCPAppsActivityType,
            content: MCPAppsActivityContentSchema,
            render: mcpAppsAllowSameOrigin
              ? SameOriginMCPAppsActivityRenderer
              : MCPAppsActivityRenderer,
          },
          openGenUIActive && {
            activityType: OpenGenerativeUIActivityType,
            content: OpenGenerativeUIContentSchema,
            render: OpenGenerativeUIActivityRenderer,
          },
          generativeUIActive && createGenerativeUIActivityRenderer(),
          generativeUIActive &&
            createGenerativeUIFunctionCallActivityRenderer(),
        ],
      }),
    [
      renderActivityMessagesList,
      a2uiActive,
      openGenUIActive,
      generativeUIActive,
      a2ui,
      filteredCatalog,
      mcpAppsAllowSameOrigin,
    ],
  );

  // Key fallback, Copilot Cloud URL, transport, agent merge and the catalog
  // property all come from core.
  const resolvedConfig = useMemo(
    () =>
      ɵresolveProviderConfig({
        runtimeUrl,
        publicApiKey,
        publicLicenseKey,
        useSingleEndpoint,
        agents__unsafe_dev_only: agents,
        selfManagedAgents,
        properties,
        a2uiCatalog: a2ui?.catalog,
      }),
    [
      runtimeUrl,
      publicApiKey,
      publicLicenseKey,
      useSingleEndpoint,
      agents,
      selfManagedAgents,
      properties,
      a2ui?.catalog,
    ],
  );
  const resolvedPublicKey = resolvedConfig.publicKey;
  // Throws in production for a missing runtime config; otherwise warns, once
  // per provider for each message.
  const loggedDiagnosticsRef = useRef(new Set<string>());
  ɵreportProviderConfigDiagnostics(resolvedConfig.diagnostics, {
    isProduction: process.env.NODE_ENV === "production",
    logged: loggedDiagnosticsRef.current,
  });

  // The latest builder, read when a request is sent (never during render).
  // Assigned during render itself (not in a `useEffect`) so a child effect
  // that fires in the SAME commit as a new builder closure — e.g. a run
  // kicked off from an effect right after a token changed — reads the new
  // closure rather than the previous commit's.
  const headersRef = useRef(headersProp);
  headersRef.current = headersProp;
  const isHeadersBuilder = typeof headersProp === "function";
  // The read below can return a sync record or an async promise depending on
  // what `headersRef.current` happens to be at call time, which
  // `CopilotKitHeadersSource`'s shape can't express in one function
  // signature (sync-only OR async-only) — same rationale as the cast inside
  // `ɵwithHeaderDefaults`.
  const stableHeadersBuilder = useCallback(() => {
    const current = headersRef.current;
    return typeof current === "function" ? current() : current;
  }, []) as () => Record<string, string>;
  // A record keeps today's identity semantics; a builder is stable.
  const headersInput = isHeadersBuilder ? stableHeadersBuilder : headersProp;
  const headersSource = useMemo(
    () =>
      ɵwithHeaderDefaults(
        headersInput,
        ɵpublicKeyHeaderDefaults(resolvedPublicKey),
      ),
    [headersInput, resolvedPublicKey],
  );

  const frontendToolsList = useStableArrayProp<ReactFrontendTool>(
    frontendTools,
    "frontendTools",
  );
  const humanInTheLoopList = useStableArrayProp<ReactHumanInTheLoop>(
    humanInTheLoop,
    "humanInTheLoop",
  );
  const sandboxFunctionsList = useStableArrayProp<SandboxFunction>(
    openGenerativeUI?.sandboxFunctions,
    "sandboxFunctions",
  );

  // Built-in frontend tool for generateSandboxedUi — registered only when the runtime has openGenerativeUI enabled
  const builtInFrontendTools = useMemo<ReactFrontendTool[]>(() => {
    if (!openGenUIActive) return [];
    return [
      {
        ...ɵcreateOpenGenerativeUITool(),
        render: OpenGenerativeUIToolRenderer,
      },
    ];
  }, [openGenUIActive]);

  // The tools and tool-call renderers for core (assembly rules from core).
  // Human-in-the-loop renders are wrapped once per `humanInTheLoop` change: a
  // new wrapper is a new component type, so React would remount the card.
  const humanInTheLoopAssembly = useMemo(
    () =>
      ɵassembleHumanInTheLoop<
        ReactToolCallRenderer<any>["render"],
        ReactHumanInTheLoop["render"]
      >({
        humanInTheLoop: humanInTheLoopList,
        // Core parks each call by tool call id until the render responds.
        // The core is created further down, so read its registry lazily.
        humanInTheLoopRegistry: () => copilotkitRef.current!.ɵhumanInTheLoop,
        wrapHumanInTheLoopRender: (render, tool, registry) => (props) =>
          createElement(
            render as React.ComponentType<any>,
            ɵhitlRenderProps(props, tool, registry()),
          ),
      }),
    [humanInTheLoopList],
  );
  const allTools = useMemo(
    () =>
      ɵassembleProviderTools({
        frontendTools: frontendToolsList,
        builtInFrontendTools,
        humanInTheLoop: humanInTheLoopAssembly,
      }),
    [frontendToolsList, builtInFrontendTools, humanInTheLoopAssembly],
  );
  const allRenderToolCalls = useMemo(
    () =>
      ɵassembleProviderToolRenderers({
        renderToolCalls: renderToolCallsList,
        frontendTools: frontendToolsList,
        builtInFrontendTools,
        humanInTheLoop: humanInTheLoopAssembly,
      }) as ReactToolCallRenderer[],
    [
      renderToolCallsList,
      frontendToolsList,
      builtInFrontendTools,
      humanInTheLoopAssembly,
    ],
  );

  // One core for the provider lifetime (ref declared above so the
  // filtered-catalog memo can read enablement off it), disposed on unmount.
  // Updates are applied via setter effects below rather than recreating the
  // instance.
  const copilotkit = ɵuseOwnedCore(
    copilotkitRef,
    () =>
      new CopilotKitCoreReact({
        runtimeUrl: resolvedConfig.runtimeUrl,
        // Defer the `/info` fetch out of construction. The core is constructed
        // during render, and React can start-and-discard renders (concurrent
        // rendering / Suspense / StrictMode) — a network request in the ctor
        // would fire once per discarded attempt (issue #5801). `connect()`
        // below starts the single request from a commit-phase effect.
        deferInitialConnection: true,
        runtimeTransport: resolvedConfig.runtimeTransport,
        headers: headersSource,
        credentials,
        messageFilter,
        properties: resolvedConfig.properties,
        agents__unsafe_dev_only: resolvedConfig.agents,
        tools: allTools,
        renderToolCalls: allRenderToolCalls,
        renderActivityMessages: allActivityRenderers,
        renderCustomMessages: renderCustomMessagesList,
        debug,
        // Set at construction so child hooks see it on their first render.
        defaultThrottleMs,
        onError,
        learning: learningConfig,
      }),
  );
  const generativeUIRuntime = useGenerativeUIRoot(copilotkit, generativeUI);

  // Shared with Vue and Angular: registers the catalog's components with core
  // (for the inspector), tells this provider when one is toggled so the
  // filtered catalog above re-derives, and owns the A2UI agent context entries
  // (scoped to `copilotkit.ɵruntimeInfo.a2uiAgents`, #5369).
  const [a2uiCatalogController] = useState(
    () => new A2UICatalogController<Catalog<any>>(copilotkit, a2uiBasicCatalog),
  );
  useEffect(
    () =>
      a2uiCatalogController.subscribe(() =>
        setCatalogToggleVersion((v) => v + 1),
      ),
    [a2uiCatalogController],
  );
  useEffect(() => {
    a2uiCatalogController.update({
      enabled: a2uiActive,
      catalog: rawCatalog,
      includeSchema: a2ui?.includeSchema,
    });
  }, [a2uiCatalogController, a2uiActive, rawCatalog, a2ui?.includeSchema]);
  useEffect(
    () => () => a2uiCatalogController.dispose(),
    [a2uiCatalogController],
  );

  // Project core's runtime info snapshot (one object with every `/info`
  // field, so no field can be missed — a missed `licenseStatus` once pinned
  // the threads drawer to "Loading threads…"). The catch-up read after
  // subscribing reflects a status that settled before this effect ran.
  useEffect(() => {
    const syncRuntimeInfo = () => setRuntimeInfo(copilotkit.ɵruntimeInfo);
    const unsubscribe = copilotkit.ɵsubscribeToRuntimeInfo(syncRuntimeInfo);
    syncRuntimeInfo();
    return unsubscribe;
  }, [copilotkit]);

  // Subscribe to render tool calls changes to force re-renders
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    const subscription = copilotkit.subscribe({
      onRenderToolCallsChanged: () => {
        forceUpdate();
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [copilotkit]);

  // Core tracks executing tool calls from the first `onToolExecutionStart`,
  // so a HITL call resumed on reconnect (before the chat mounts) is already
  // executing when children first read it.
  const subscribeExecutingToolCalls = useCallback(
    (onChange: () => void) =>
      copilotkit.subscribe({ onExecutingToolCallsChanged: onChange })
        .unsubscribe,
    [copilotkit],
  );
  const getExecutingToolCallIds = () => copilotkit.executingToolCallIds;
  const executingToolCallIds = useSyncExternalStore(
    subscribeExecutingToolCalls,
    getExecutingToolCallIds,
    getExecutingToolCallIds,
  );

  // Core calls `onError`, and logs the error itself when there is none.
  useEffect(() => {
    copilotkit.setErrorHandler(onError);
  }, [copilotkit, onError]);

  useEffect(() => {
    // Core applies the message filter first, so an agent discovered by the
    // connection below is built with it. The generative UI envelope is not in
    // these properties: useGenerativeUIRoot adds it as scoped properties, so
    // this call does not replace it.
    copilotkit.ɵupdateConfig({
      messageFilter,
      runtimeUrl: resolvedConfig.runtimeUrl,
      runtimeTransport: resolvedConfig.runtimeTransport,
      headers: headersSource,
      credentials,
      properties: resolvedConfig.properties,
      agents__unsafe_dev_only: resolvedConfig.agents,
      debug,
      defaultThrottleMs,
    });
    // Start the runtime `/info` connection now that we're in the commit phase.
    // The ctor deferred it (see `deferInitialConnection` above) so discarded
    // renders never fetch; `connect()` is idempotent, so StrictMode's
    // double-invoked effect and re-runs on unrelated prop changes collapse to a
    // single request (a real runtimeUrl/transport change reconnects via the
    // update above). See #5801.
    copilotkit.connect();
  }, [
    copilotkit,
    messageFilter,
    resolvedConfig.runtimeUrl,
    resolvedConfig.runtimeTransport,
    headersSource,
    credentials,
    resolvedConfig.properties,
    resolvedConfig.agents,
    debug,
    defaultThrottleMs,
  ]);

  // Start the Trajectory in the commit phase, after the runtime URL is set, so
  // CopilotKit's own runtime traffic is never captured. The starter keeps its
  // generated Trajectory ID across StrictMode's dispose and replay.
  const learningStarterRef = useRef<ɵLearningAutoStarter | null>(null);
  learningStarterRef.current ??= new ɵLearningAutoStarter(copilotkit);
  const learningStarter = learningStarterRef.current;
  useEffect(() => {
    learningStarter.update(learning);
  }, [learningStarter, learning]);
  useEffect(() => () => learningStarter.dispose(), [learningStarter]);

  // Sync render/tool arrays to the stable instance via setters.
  // On mount, the constructor already receives the correct initial values,
  // so we skip the first invocation. This is critical because child hooks
  // (e.g., useFrontendTool, useHumanInTheLoop) register tools dynamically
  // via addTool()/setRenderToolCalls() in their own effects, which fire
  // BEFORE parent effects (React fires effects bottom-up). If the parent
  // setter effects ran on mount, they would overwrite the children's tools.
  const didMountRef = useRef(false);

  useEffect(() => {
    if (!didMountRef.current) return;
    copilotkit.setTools(allTools);
  }, [copilotkit, allTools]);

  useEffect(() => {
    if (!didMountRef.current) return;
    copilotkit.setRenderToolCalls(allRenderToolCalls);
  }, [copilotkit, allRenderToolCalls]);

  useEffect(() => {
    if (!didMountRef.current) return;
    copilotkit.setRenderActivityMessages(allActivityRenderers);
  }, [copilotkit, allActivityRenderers]);

  useEffect(() => {
    if (!didMountRef.current) return;
    copilotkit.setRenderCustomMessages(renderCustomMessagesList);
  }, [copilotkit, renderCustomMessagesList]);

  // Mark mount complete — must be declared AFTER the setter effects
  // so it runs last in the effect queue on the initial mount cycle. Reset on
  // cleanup, so a remount (StrictMode) or a replacement core skips the setters
  // again instead of overwriting tools the children just registered.
  useEffect(() => {
    didMountRef.current = true;
    return () => {
      didMountRef.current = false;
    };
  }, [copilotkit]);

  // Register the design skill and the sandbox functions as agent context for
  // the generateSandboxedUi tool (entries shared with Vue and Angular).
  const designSkill = openGenerativeUI?.designSkill;
  useLayoutEffect(() => {
    if (!copilotkit || !openGenUIActive) return;
    return ɵaddOpenGenerativeUIContexts(copilotkit, {
      designSkill,
      sandboxFunctions: sandboxFunctionsList,
    });
  }, [copilotkit, designSkill, sandboxFunctionsList, openGenUIActive]);

  const contextValue = useMemo<CopilotKitContextValue>(
    () => ({
      copilotkit,
      executingToolCallIds,
      showIntelligenceIndicator,
    }),
    [copilotkit, executingToolCallIds, showIntelligenceIndicator],
  );

  // License context and banner, driven by the license authority the runtime
  // reports through /info.
  const licenseState = useMemo(
    () =>
      ɵresolveLicenseState({
        status: runtimeLicenseStatus,
        entitlements: runtimeEntitlements,
        retryPending: runtimeEntitlementRetryPending,
        publicKey: resolvedPublicKey,
      }),
    [
      runtimeLicenseStatus,
      runtimeEntitlements,
      runtimeEntitlementRetryPending,
      resolvedPublicKey,
    ],
  );
  const styleOptions = useMemo(
    () => ({ nonce, inject: injectStyles }),
    [nonce, injectStyles],
  );

  return (
    <CopilotStyleOptionsProvider value={styleOptions}>
      <SandboxFunctionsContext.Provider value={sandboxFunctionsList}>
        <CopilotKitContext.Provider value={contextValue}>
          <LicenseContext.Provider value={licenseState.context}>
            {a2uiActive && <A2UIBuiltInToolCallRenderer />}
            {generativeUIActive && <GenerativeUIToolCallRenderer />}
            <MarkdownRendererProvider renderer={markdownRenderer}>
              <CopilotKitInspectorContextProvider value={inspectorContextValue}>
                {/*
                Publish the provider-level agent default. This is a bare string
                context, NOT a `CopilotChatConfigurationProvider`: that provider
                also owns a thread, so wrapping the application in one would give
                every descendant chat the same inherited threadId. See the
                `CopilotKitAgentIdContext` comment in `../context`.
              */}
                <CopilotKitAgentIdContext.Provider value={agentId}>
                  <GenerativeUIRuntimeContext.Provider
                    value={generativeUIRuntime}
                  >
                    {children}
                  </GenerativeUIRuntimeContext.Provider>
                </CopilotKitAgentIdContext.Provider>
                {shouldRenderInspector ? (
                  <CopilotKitInspector
                    core={copilotkit}
                    openRequest={inspectorOpenRequest}
                    onVisibilityChange={setInspectorVisible}
                  />
                ) : null}
              </CopilotKitInspectorContextProvider>
            </MarkdownRendererProvider>
            {/* License warnings — driven by server-reported status */}
            {licenseState.bannerType && (
              <LicenseWarningBanner type={licenseState.bannerType} />
            )}
          </LicenseContext.Provider>
        </CopilotKitContext.Provider>
      </SandboxFunctionsContext.Provider>
    </CopilotStyleOptionsProvider>
  );
};

/**
 * Alias of {@link CopilotKitProvider}: the same component under its v1 name,
 * so `<CopilotKit>` keeps working. `CopilotKitProvider` is the preferred name.
 *
 * @alias
 */
export const CopilotKit = CopilotKitProvider;

/**
 * Alias of {@link CopilotKitProviderProps}, the props of {@link CopilotKit}.
 * Prefer `CopilotKitProviderProps` in new code.
 */
export type CopilotKitProps = CopilotKitProviderProps;

// Re-export useCopilotKit from context for backward compatibility
export { useCopilotKit } from "../context";
