"use client";

import {
  GENERATE_SANDBOXED_UI_DESCRIPTION,
  randomUUID,
  ɵanySchema,
} from "@copilotkit/shared";
import type { AbstractAgent } from "@ag-ui/client";
import type {
  FrontendTool,
  ɵA2UIBaseOptions,
  ɵCopilotKitLearningOptions,
  ɵCopilotKitProviderBaseOptions,
  ɵRuntimeInfo,
} from "@copilotkit/core";
import { ToolCallStatus } from "@copilotkit/core";
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
  DEFAULT_OPEN_GENERATIVE_UI_DESIGN_SKILL,
  GENERATE_SANDBOXED_UI_TOOL_NAME,
  ɵSTABLE_ARRAY_WARNINGS,
  ɵpublicKeyHeaderDefaults,
  ɵreportProviderConfigDiagnostics,
  ɵresolveLicenseState,
  ɵresolveProviderConfig,
  ɵtoolRendererShapeChanged,
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
  GenerateSandboxedUiArgsSchema,
} from "../components/OpenGenerativeUIRenderer";
import { createA2UIMessageRenderer } from "../a2ui/A2UIMessageRenderer";
import type { A2UIRecoveryRendererOptions } from "../a2ui/A2UIRecoveryStates";
import { A2UIBuiltInToolCallRenderer } from "../a2ui/A2UIToolCallRenderer";
import { A2UICatalogContext } from "../a2ui/A2UICatalogContext";
import { useGenerativeUIRoot } from "../generative-ui/use-generative-ui-root";
import type { GenerativeUIConfig } from "../generative-ui/runtime-context";
import {
  createGenerativeUIActivityRenderer,
  createGenerativeUIFunctionCallActivityRenderer,
  GenerativeUIToolCallRenderer,
} from "../generative-ui/chat";
import { GenerativeUIRuntimeContext } from "../generative-ui/runtime-context";
import { viewerTheme, filterCatalog, Catalog } from "@copilotkit/a2ui-renderer";
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
import { schemaToJsonSchema, shouldEnableInspector } from "@copilotkit/shared";

// Stable frozen defaults keep provider effects from re-running just because a
// caller omitted an object prop on a rerender.
const EMPTY_HEADERS: Readonly<Record<string, string>> = Object.freeze({});
const EMPTY_PROPERTIES: Readonly<Record<string, unknown>> = Object.freeze({});
const EMPTY_AGENTS: Readonly<Record<string, AbstractAgent>> = Object.freeze({});
/** Registration name of a catch-all tool: handles any otherwise-unhandled call. */
const WILDCARD_TOOL_NAME = "*";
// Same message `useHumanInTheLoop` rejects with, so an aborted interrupt reads
// identically whichever registration path declared the tool (see #5554).
const HUMAN_IN_THE_LOOP_ABORTED_MESSAGE =
  "Human-in-the-loop interaction aborted";

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
   * <CopilotKit
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
   * <CopilotKit runtimeUrl="/api/copilotkit" a2ui={{ theme: myCustomTheme }}>
   *   {children}
   * </CopilotKit>
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

type LearningProp = ɵCopilotKitLearningOptions;

// `learning={true}` uses the default authenticated capture options. One shared
// object keeps the config stable across renders.
const DEFAULT_LEARNING: LearningProp = Object.freeze({});

function toLearningConfig(
  learning: boolean | LearningProp | undefined,
): LearningProp | undefined {
  if (learning === true) return DEFAULT_LEARNING;
  if (learning === false || learning === undefined) return undefined;
  // `autoStart` only controls the provider; Core never receives it.
  const { autoStart: _autoStart, ...config } = learning;
  return config;
}

// Small helper to normalize array props to a stable reference and warn
function useStableArrayProp<T>(
  prop: T[] | undefined,
  warningMessage?: string,
  isMeaningfulChange?: (initial: T[], next: T[]) => boolean,
): T[] {
  const empty = useMemo<T[]>(() => [], []);
  const value = prop ?? empty;
  const initial = useRef(value);

  useEffect(() => {
    if (
      warningMessage &&
      value !== initial.current &&
      (isMeaningfulChange ? isMeaningfulChange(initial.current, value) : true)
    ) {
      console.error(warningMessage);
    }
  }, [value, warningMessage]);

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
  licenseToken,
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
  const learningConfig = useMemo(() => toLearningConfig(learning), [learning]);

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
      }) &&
        ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname),
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
  const openGenUIActive = runtimeOpenGenUIEnabled || !!openGenerativeUI;
  // A catalog passed to the provider is enough to turn A2UI on: render the
  // surfaces locally and forward the catalog signal so the runtime injects the
  // render tool — no runtime-side `a2ui` config required.
  const a2uiCatalogProvided = !!a2ui?.catalog;
  const a2uiActive = runtimeA2UIEnabled || a2uiCatalogProvided;
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
  const renderToolCallsList = useStableArrayProp<ReactToolCallRenderer<any>>(
    renderToolCalls,
    ɵSTABLE_ARRAY_WARNINGS.renderToolCalls,
    // Only warn if the shape (names+agentId) changed. Allow identity changes
    // to support updated closures from parents (e.g., Storybook state).
    ɵtoolRendererShapeChanged,
  );

  const renderCustomMessagesList =
    useStableArrayProp<ReactCustomMessageRenderer>(
      renderCustomMessages,
      ɵSTABLE_ARRAY_WARNINGS.renderCustomMessages,
    );

  const renderActivityMessagesList = useStableArrayProp<
    ReactActivityMessageRenderer<any>
  >(renderActivityMessages, ɵSTABLE_ARRAY_WARNINGS.renderActivityMessages);

  // Stable core instance ref, declared here (before the activity-renderer memo)
  // so the filtered-catalog memo can read enablement off the current instance.
  // The instance itself is created in the ref-init block below; on the very
  // first render `current` is still null (nothing is disabled yet), so the
  // filtered catalog correctly equals the full catalog.
  const copilotkitRef = useRef<CopilotKitCoreReact | null>(null);

  // Raw catalog provided by the caller (typed loosely to match `a2ui.catalog?: any`).
  const rawCatalog = a2ui?.catalog as Catalog<any> | undefined;

  // Derive the FILTERED catalog: only components currently enabled on core.
  // Re-derives when enablement changes (catalogToggleVersion bump from the
  // onCatalogComponentsChanged subscription below). Passed to BOTH the render
  // path (createA2UIMessageRenderer) and the advertisement path (A2UICatalogContext)
  // so a disabled component vanishes from what the model sees AND what can paint.
  const filteredCatalog = useMemo(() => {
    if (!rawCatalog) return rawCatalog;
    // `filterCatalog` rebuilds a real `Catalog` (reads `.functions`). Callers may
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

  // Built-in activity renderers that are always included
  const builtInActivityRenderers = useMemo<
    ReactActivityMessageRenderer<any>[]
  >(() => {
    const renderers: ReactActivityMessageRenderer<any>[] = [
      {
        activityType: MCPAppsActivityType,
        content: MCPAppsActivityContentSchema,
        render: mcpAppsAllowSameOrigin
          ? SameOriginMCPAppsActivityRenderer
          : MCPAppsActivityRenderer,
      },
    ];

    if (openGenUIActive) {
      renderers.push({
        activityType: OpenGenerativeUIActivityType,
        content: OpenGenerativeUIContentSchema,
        render: OpenGenerativeUIActivityRenderer,
      });
    }

    if (a2uiActive) {
      // The a2ui-surface renderer owns the WHOLE generative-UI lifecycle (OSS-162):
      // building skeleton → retrying → hard-failure → painted surface, all on one
      // activity, swapped in place. `recovery` tunes the pre-paint UX (timing +
      // debug exposure); the server can override debugExposure via the middleware.
      renderers.unshift(
        createA2UIMessageRenderer({
          theme: a2ui?.theme ?? viewerTheme,
          catalog: filteredCatalog,
          loadingComponent: a2ui?.loadingComponent,
          recovery: a2ui?.recovery,
        }),
      );
    }

    if (generativeUIActive) {
      renderers.push(
        createGenerativeUIActivityRenderer(),
        createGenerativeUIFunctionCallActivityRenderer(),
      );
    }

    return renderers;
  }, [
    a2uiActive,
    openGenUIActive,
    generativeUIActive,
    a2ui,
    filteredCatalog,
    mcpAppsAllowSameOrigin,
  ]);

  // Combine user-provided activity renderers with built-in ones
  // User-provided renderers take precedence (come first) so they can override built-ins
  const allActivityRenderers = useMemo(() => {
    return [...renderActivityMessagesList, ...builtInActivityRenderers];
  }, [renderActivityMessagesList, builtInActivityRenderers]);

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
    ɵSTABLE_ARRAY_WARNINGS.frontendTools,
  );
  /**
   * A `humanInTheLoop` prop tool call that is parked, waiting on the user.
   * Keyed by tool call id, so parallel calls of one tool stay independent.
   */
  const pendingHumanInTheLoopRef = useRef<
    Map<
      string,
      { resolve: (result: unknown) => void; detachAbort?: () => void }
    >
  >(new Map());

  const humanInTheLoopList = useStableArrayProp<ReactHumanInTheLoop>(
    humanInTheLoop,
    ɵSTABLE_ARRAY_WARNINGS.humanInTheLoop,
  );
  const sandboxFunctionsList = useStableArrayProp<SandboxFunction>(
    openGenerativeUI?.sandboxFunctions,
    ɵSTABLE_ARRAY_WARNINGS.sandboxFunctions,
  );

  // Note: warnings for array identity changes are handled by useStableArrayProp

  // Process humanInTheLoop tools to create handlers and add render components
  const processedHumanInTheLoopTools = useMemo(() => {
    const processedTools: FrontendTool[] = [];
    const processedRenderToolCalls: ReactToolCallRenderer<unknown>[] = [];

    humanInTheLoopList.forEach((tool) => {
      // Create a promise-based handler for each human-in-the-loop tool
      const frontendTool: FrontendTool = {
        type: "human-in-the-loop",
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        followUp: tool.followUp,
        ...(tool.agentId && { agentId: tool.agentId }),
        // Park the tool call until the render calls `respond`, matching
        // `useHumanInTheLoop`. Resolving here would hand the agent an empty
        // result and leave the render stranded at `Complete`.
        handler: async (_args, context) => {
          const signal = context?.signal;
          const key = context?.toolCall?.id ?? tool.name;

          return new Promise((resolve, reject) => {
            // Aborted before the handler ran: reject so core records an
            // explicit error tool result instead of an empty success.
            if (signal?.aborted) {
              reject(new Error(HUMAN_IN_THE_LOOP_ABORTED_MESSAGE));
              return;
            }

            const pending: {
              resolve: (result: unknown) => void;
              detachAbort?: () => void;
            } = { resolve };
            pendingHumanInTheLoopRef.current.set(key, pending);

            if (signal) {
              const onAbort = () => {
                pendingHumanInTheLoopRef.current.delete(key);
                reject(new Error(HUMAN_IN_THE_LOOP_ABORTED_MESSAGE));
              };
              signal.addEventListener("abort", onAbort, { once: true });
              pending.detachAbort = () => {
                signal.removeEventListener("abort", onAbort);
              };
            }
          });
        },
      };
      processedTools.push(frontendTool);

      // Add the render component to renderToolCalls, wrapped so it receives the
      // full human-in-the-loop prop contract the hook path also provides.
      if (tool.render) {
        const ToolComponent = tool.render as React.ComponentType<any>;
        const RenderComponent: React.ComponentType<any> = (props) =>
          createElement(ToolComponent, {
            ...props,
            // `props.name` is the tool actually invoked. It equals `tool.name`
            // for a named registration; for a catch-all it is the only place
            // the real name exists, which is what lets one render serve N tools.
            name: tool.name === WILDCARD_TOOL_NAME ? props.name : tool.name,
            description: tool.description || "",
            agentId: tool.agentId,
            // `respond` is live only while the call is executing — the one
            // phase with a promise waiting on the user.
            respond:
              props.status === ToolCallStatus.Executing
                ? async (result: unknown) => {
                    const pending = pendingHumanInTheLoopRef.current.get(
                      props.toolCallId,
                    );
                    if (!pending) return;
                    pending.detachAbort?.();
                    pendingHumanInTheLoopRef.current.delete(props.toolCallId);
                    pending.resolve(result);
                  }
                : undefined,
          });

        processedRenderToolCalls.push({
          name: tool.name,
          args: tool.parameters,
          render: RenderComponent,
          ...(tool.agentId && { agentId: tool.agentId }),
        });
      }
    });

    return { tools: processedTools, renderToolCalls: processedRenderToolCalls };
  }, [humanInTheLoopList]);

  // Built-in frontend tool for generateSandboxedUi — registered only when the runtime has openGenerativeUI enabled
  const builtInFrontendTools = useMemo<ReactFrontendTool[]>(() => {
    if (!openGenUIActive) return [];
    return [
      {
        name: GENERATE_SANDBOXED_UI_TOOL_NAME,
        description: GENERATE_SANDBOXED_UI_DESCRIPTION,
        parameters: GenerateSandboxedUiArgsSchema,
        handler: async () => "UI generated",
        // This acknowledgement has no side effects and is safe to reconstruct.
        reconnectBehavior: "resume-pending",
        followUp: true,
        render: OpenGenerativeUIToolRenderer,
      },
    ];
  }, [openGenUIActive]);

  // Combine all tools for CopilotKitCore
  const allTools = useMemo(() => {
    const tools: FrontendTool[] = [];

    // Add frontend tools (user-provided + built-in)
    tools.push(...frontendToolsList);
    tools.push(...builtInFrontendTools);

    // Add processed human-in-the-loop tools
    tools.push(...processedHumanInTheLoopTools.tools);

    return tools;
  }, [frontendToolsList, builtInFrontendTools, processedHumanInTheLoopTools]);

  // Combine all render tool calls
  const allRenderToolCalls = useMemo(() => {
    const combined: ReactToolCallRenderer<unknown>[] = [...renderToolCallsList];

    // Add render components from frontend tools (user-provided + built-in)
    [...frontendToolsList, ...builtInFrontendTools].forEach((tool) => {
      if (tool.render) {
        // For wildcard tools without parameters, default to a schema that
        // accepts any value
        const args =
          tool.parameters || (tool.name === "*" ? ɵanySchema : undefined);
        if (args) {
          combined.push({
            name: tool.name,
            args: args,
            render: tool.render,
          } as ReactToolCallRenderer<unknown>);
        }
      }
    });

    // Add render components from human-in-the-loop tools
    combined.push(...processedHumanInTheLoopTools.renderToolCalls);

    return combined;
  }, [
    renderToolCallsList,
    frontendToolsList,
    builtInFrontendTools,
    processedHumanInTheLoopTools,
  ]);

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

  // Register the full A2UI catalog component list onto core so the inspector can
  // read `core.catalogComponents`, and re-derive the filtered catalog whenever
  // enablement changes. Descriptions are undefined here because the built
  // ComponentApi does not carry them (see plan A2 rationale).
  useEffect(() => {
    if (!rawCatalog) return;
    // Only register components for genuine `Catalog` instances, mirroring the
    // `filteredCatalog` guard above. A non-`Catalog` catalog-shaped object is
    // passed through UNFILTERED by `filteredCatalog`, so registering its
    // components here would make them toggleable in the inspector while
    // disabling never actually removes them from what the model sees — a silent
    // enforcement divergence. Guarding here keeps registration and filtering
    // consistent (nothing registered → nothing to toggle → nothing to filter)
    // and also avoids a mount-time throw when `.components` isn't a Map.
    if (!(rawCatalog instanceof Catalog)) return;
    const components = Array.from(rawCatalog.components.values()).map(
      (comp: { name: string; schema: unknown }) => ({
        name: comp.name,
        description: undefined as string | undefined,
        schema: comp.schema,
      }),
    );
    copilotkit.setCatalogComponents(components);
    const subscription = copilotkit.subscribe({
      onCatalogComponentsChanged: () => {
        setCatalogToggleVersion((v) => v + 1);
      },
    });
    return () => subscription.unsubscribe();
  }, [copilotkit, rawCatalog]);

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

  // Track executing tool call IDs at the provider level.
  // This is critical for HITL reconnection: when connecting to a thread with
  // pending tool calls, the onToolExecutionStart event fires before child components
  // (like CopilotChatToolCallsView) mount. By tracking at the provider level,
  // we ensure the executing state is captured and available when children mount.
  const [executingToolCallIds, setExecutingToolCallIds] = useState<
    ReadonlySet<string>
  >(() => new Set());

  useEffect(() => {
    const subscription = copilotkit.subscribe({
      onToolExecutionStart: ({ toolCallId }) => {
        setExecutingToolCallIds((prev) => {
          if (prev.has(toolCallId)) return prev;
          const next = new Set(prev);
          next.add(toolCallId);
          return next;
        });
      },
      onToolExecutionEnd: ({ toolCallId }) => {
        setExecutingToolCallIds((prev) => {
          if (!prev.has(toolCallId)) return prev;
          const next = new Set(prev);
          next.delete(toolCallId);
          return next;
        });
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [copilotkit]);

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
  // CopilotKit's own runtime traffic is never captured. Under StrictMode the
  // start/stop/start sequence installs the capture hooks once.
  const learningEnabled = learningConfig !== undefined;
  // `true` is the options-free form, so only an object can opt out.
  const autoStart =
    learningEnabled &&
    (typeof learning !== "object" || learning.autoStart !== false);
  const suppliedTrajectoryId = autoStart
    ? learningConfig?.trajectoryId
    : undefined;
  const generatesTrajectoryId = autoStart && suppliedTrajectoryId === undefined;
  const learningContainerIdsRef = useRef(learningConfig?.learningContainerIds);
  // Kept outside the effect so StrictMode replays and dependency changes that
  // keep generating restart the same Trajectory.
  const generatedTrajectoryIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    copilotkit.setLearningConfig(learningConfig);
    learningContainerIdsRef.current = learningConfig?.learningContainerIds;
    // Automatic starts report unsupported options in Core. With manual starts,
    // the provider's container option is not part of startTrajectory() options.
    if (
      learningConfig?.sink === undefined &&
      !autoStart &&
      learningConfig?.learningContainerIds !== undefined
    ) {
      console.warn(
        "[CopilotKit] learningContainerIds is supported only with a custom sink. Authenticated Trajectory capture ignores it; assign Learning Spaces on the server with getTrajectoryLearningContainerIds on CopilotKitIntelligence, and remove learningContainerIds from the capture options.",
      );
    }
  }, [copilotkit, learningConfig, autoStart]);

  // Keyed on a boolean so an inline `learning` object warns once, not per render.
  const ignoresTrajectoryId =
    !autoStart && learningConfig?.trajectoryId !== undefined;
  useEffect(() => {
    if (!ignoresTrajectoryId) return;
    console.warn(
      "[CopilotKit] learning.trajectoryId is ignored when autoStart is false; pass the ID to startTrajectory() instead.",
    );
  }, [ignoresTrajectoryId]);

  useEffect(() => {
    // Leaving generation ends its Trajectory; generating again starts a new one.
    if (!generatesTrajectoryId) generatedTrajectoryIdRef.current = undefined;
    if (!learningEnabled) return;
    let disposed = false;
    const trajectoryId = generatesTrajectoryId
      ? (generatedTrajectoryIdRef.current ??= randomUUID())
      : suppliedTrajectoryId;
    if (trajectoryId !== undefined) {
      void copilotkit
        .startTrajectory({
          trajectoryId,
          learningContainerIds: learningContainerIdsRef.current,
        })
        .catch(() => {
          // Expected authentication/connection failures resolve with an error
          // result; Core reports them to LearningConfig.onError or warns once.
          // Consume unexpected rejections without logging credentials or errors from
          // a previous effect after a new Trajectory has already started.
          if (!disposed) {
            console.warn("[CopilotKit] Failed to start interaction capture.");
          }
        });
    }
    return () => {
      disposed = true;
      copilotkit.stopTrajectory();
    };
  }, [
    copilotkit,
    learningEnabled,
    generatesTrajectoryId,
    suppliedTrajectoryId,
  ]);

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

  // Register design skill as agent context for the generateSandboxedUi tool
  const designSkill =
    openGenerativeUI?.designSkill ?? DEFAULT_OPEN_GENERATIVE_UI_DESIGN_SKILL;

  useLayoutEffect(() => {
    if (!copilotkit || !openGenUIActive) return;

    const id = copilotkit.addContext({
      description:
        "Design guidelines for the generateSandboxedUi tool. Follow these when building UI.",
      value: designSkill,
    });
    return () => {
      copilotkit.removeContext(id);
    };
  }, [copilotkit, designSkill, openGenUIActive]);

  // Register sandbox functions as agent context so the LLM knows how to call them
  const sandboxFunctionsDescriptors = useMemo(() => {
    if (sandboxFunctionsList.length === 0) return null;
    return JSON.stringify(
      sandboxFunctionsList.map((fn) => ({
        name: fn.name,
        description: fn.description,
        parameters: schemaToJsonSchema(fn.parameters),
      })),
    );
  }, [sandboxFunctionsList]);

  useLayoutEffect(() => {
    if (!copilotkit || !sandboxFunctionsDescriptors || !openGenUIActive) return;

    const id = copilotkit.addContext({
      description:
        "Sandbox functions available in generated sandboxed UI code. Call via: await Websandbox.connection.remote.<functionName>(args)",
      value: sandboxFunctionsDescriptors,
    });
    return () => {
      copilotkit.removeContext(id);
    };
  }, [copilotkit, sandboxFunctionsDescriptors, openGenUIActive]);

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
            {a2uiActive && (
              <A2UICatalogContext
                catalog={filteredCatalog}
                includeSchema={a2ui?.includeSchema}
              />
            )}
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

// Re-export useCopilotKit from context for backward compatibility
export { useCopilotKit } from "../context";
