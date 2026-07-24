"use client";

import type { AbstractAgent } from "@ag-ui/client";
import type { FrontendTool } from "@copilotkit/core";
import type React from "react";
import {
  useMemo,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
// Context extracted to ../context.ts for cross-platform reuse (React Native)
import { CopilotKitContext, LicenseContext } from "../context";
import type { CopilotKitContextValue } from "../context";
export type { CopilotKitContextValue } from "../context";
export { CopilotKitContext, useLicenseContext } from "../context";
import { z } from "zod";
import { CopilotKitInspector } from "../components/CopilotKitInspector";
import type { Anchor } from "@copilotkit/web-inspector";
import { LicenseWarningBanner } from "../components/license-warning-banner";
import { createLicenseContextValue } from "@copilotkit/shared";
import type {
  LicenseContextValue,
  DebugConfig,
  RuntimeEntitlementResponse,
  RuntimeLicenseStatus,
} from "@copilotkit/shared";
import type { CopilotKitCoreErrorCode } from "@copilotkit/core";
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
import { viewerTheme } from "@copilotkit/a2ui-renderer";
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
import { schemaToJsonSchema } from "@copilotkit/shared";
import { zodToJsonSchema } from "zod-to-json-schema";

// Adapts zod-to-json-schema's zod-specific signature to the injectable
// `zodToJsonSchema` contract of `schemaToJsonSchema`, which only invokes it
// for schemas whose `~standard.vendor` is "zod".
const zodToJsonSchemaAdapter = (
  schema: unknown,
  options?: { $refStrategy?: string },
): Record<string, unknown> => {
  const refStrategy = options?.$refStrategy;
  return zodToJsonSchema(
    schema as z.ZodType,
    refStrategy === "root" ||
      refStrategy === "relative" ||
      refStrategy === "none" ||
      refStrategy === "seen"
      ? { $refStrategy: refStrategy }
      : {},
  );
};

const HEADER_NAME = "X-CopilotCloud-Public-Api-Key";
const COPILOT_CLOUD_CHAT_URL = "https://api.cloud.copilotkit.ai/copilotkit/v1";
// Stable frozen defaults keep provider effects from re-running just because a
// caller omitted an object prop on a rerender.
const EMPTY_HEADERS: Readonly<Record<string, string>> = Object.freeze({});
const EMPTY_PROPERTIES: Readonly<Record<string, unknown>> = Object.freeze({});
const EMPTY_AGENTS: Readonly<Record<string, AbstractAgent>> = Object.freeze({});

const DEFAULT_DESIGN_SKILL = `When generating UI with generateSandboxedUi, follow these design principles inspired by shadcn/ui:

- Use a minimal, flat aesthetic. Avoid drop shadows and gradients — rely on subtle borders (1px solid, light gray like #e5e7eb) to define surfaces.
- Neutral base palette: white backgrounds, zinc/slate gray text (#09090b for headings, #71717a for secondary text). One accent color for interactive elements.
- Use system font stacks (system-ui, -apple-system, sans-serif) at readable sizes (14px body, 600 weight for headings). Tight line-heights.
- Small, consistent border-radius (6–8px). Cards and containers use border, not shadow, for separation.
- Buttons: solid fill for primary (dark bg, white text), outline for secondary (border + transparent bg). Subtle hover state (slight opacity or background shift).
- Use CSS Grid or Flexbox for layout. Ensure the UI looks good at any width.
- Minimal transitions (150ms) for hover/focus states only. No decorative animations.
- Keep the UI focused and dense — avoid excessive padding. Use compact spacing (8–12px gaps, 10–14px padding in controls).`;

const GENERATE_SANDBOXED_UI_DESCRIPTION =
  "Generate sandboxed UI. " +
  "IMPORTANT: The generated code runs in a sandboxed iframe WITHOUT same-origin access. " +
  "Do NOT use localStorage, sessionStorage, document.cookie, IndexedDB, or fetch/XMLHttpRequest to same-origin URLs. " +
  "To communicate with the host application, use Websandbox.connection.remote.<functionName>(args) which returns a Promise.\n\n" +
  "You CAN use external libraries from CDNs by including <script> or <link> tags in the HTML <head> (e.g., Chart.js, D3, Three.js, x-data-spreadsheet, etc.). " +
  "CDN resources load normally inside the sandbox.\n\n" +
  "PARAMETER ORDER IS CRITICAL — generate parameters in exactly this order:\n" +
  "1. initialHeight + placeholderMessages (shown to user while generating)\n" +
  "2. css (all styles FIRST — the user sees a placeholder until CSS is complete)\n" +
  "3. html (streams in live — the user watches the UI build as HTML is generated)\n" +
  "4. jsFunctions (reusable helper functions)\n" +
  "5. jsExpressions (applied one-by-one — the user sees each expression take effect)";
// Provider props interface
export interface CopilotKitProviderProps {
  children: ReactNode;
  runtimeUrl?: string;
  headers?: Record<string, string> | (() => Record<string, string>);
  /**
   * Credentials mode for fetch requests (e.g., "include" for HTTP-only cookies in cross-origin requests).
   */
  credentials?: RequestCredentials;
  /** Your CopilotKit public license key. */
  publicApiKey?: string;
  /** Your public license key for accessing Enterprise Intelligence Platform features. */
  publicLicenseKey?: string;
  /**
   * Signed license token for offline verification of Enterprise Intelligence Platform features.
   * Obtain from https://dashboard.operations.copilotkit.ai.
   */
  licenseToken?: string;
  properties?: Record<string, unknown>;
  useSingleEndpoint?: boolean;
  agents__unsafe_dev_only?: Record<string, AbstractAgent>;
  selfManagedAgents?: Record<string, AbstractAgent>;
  renderToolCalls?: ReactToolCallRenderer<any>[];
  renderActivityMessages?: ReactActivityMessageRenderer<any>[];
  renderCustomMessages?: ReactCustomMessageRenderer[];
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
  showDevConsole?: boolean | "auto";
  /**
   * Error handler called when CopilotKit encounters an error.
   * Fires for all error types (runtime connection failures, agent errors, tool errors).
   */
  onError?: (event: {
    error: Error;
    code: CopilotKitCoreErrorCode;
    context: Record<string, any>;
  }) => void | Promise<void>;
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
  a2ui?: {
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
     * When true (the default), the full component schemas from the catalog are
     * sent as agent context so the agent knows what components and props are
     * available. The A2UI middleware can overwrite this with a server-side
     * schema if configured. Set to false to disable.
     */
    includeSchema?: boolean;
    /**
     * Options for the A2UI error-recovery status UI (OSS-162): how long before
     * the transient "Retrying…" hint appears, after how many attempts, and how
     * much retry/debug detail to surface. When omitted, sane defaults apply.
     */
    recovery?: A2UIRecoveryRendererOptions;
  };
  /**
   * Default throttle interval (in milliseconds) for `useAgent` re-renders
   * triggered by `OnMessagesChanged` notifications. This value is used as
   * a fallback when neither the `useAgent()` hook nor `<CopilotChat>` /
   * `<CopilotSidebar>` / `<CopilotPopup>` specify an explicit `throttleMs`.
   *
   * @default undefined (components/hooks without an explicit throttleMs will be unthrottled)
   */
  defaultThrottleMs?: number;
  /**
   * Default anchor corner for the inspector button and window.
   * Only used on first load before the user drags to a custom position.
   * Defaults to `{ horizontal: "right", vertical: "top" }`.
   */
  inspectorDefaultAnchor?: Anchor;
  /**
   * Enable debug logging for the client-side event pipeline.
   */
  debug?: DebugConfig;
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

// Provider component
export const CopilotKitProvider: React.FC<CopilotKitProviderProps> = ({
  children,
  runtimeUrl,
  headers: headersProp = EMPTY_HEADERS,
  credentials,
  publicApiKey,
  publicLicenseKey,
  licenseToken,
  properties = EMPTY_PROPERTIES,
  agents__unsafe_dev_only: agents = EMPTY_AGENTS,
  selfManagedAgents = EMPTY_AGENTS,
  renderToolCalls,
  renderActivityMessages,
  renderCustomMessages,
  frontendTools,
  humanInTheLoop,
  openGenerativeUI,
  showDevConsole = false,
  useSingleEndpoint,
  onError,
  a2ui,
  defaultThrottleMs,
  inspectorDefaultAnchor,
  debug,
}) => {
  const [shouldRenderInspector, setShouldRenderInspector] = useState(false);
  const [runtimeA2UIEnabled, setRuntimeA2UIEnabled] = useState(false);
  const [runtimeOpenGenUIEnabled, setRuntimeOpenGenUIEnabled] = useState(false);
  const openGenUIActive = runtimeOpenGenUIEnabled || !!openGenerativeUI;
  // A catalog passed to the provider is enough to turn A2UI on: render the
  // surfaces locally and forward the catalog signal so the runtime injects the
  // render tool — no runtime-side `a2ui` config required.
  const a2uiCatalogProvided = !!a2ui?.catalog;
  const a2uiActive = runtimeA2UIEnabled || a2uiCatalogProvided;
  const [runtimeLicenseStatus, setRuntimeLicenseStatus] = useState<
    RuntimeLicenseStatus | undefined
  >(undefined);
  const [runtimeEntitlements, setRuntimeEntitlements] = useState<
    RuntimeEntitlementResponse | undefined
  >(undefined);
  const [runtimeEntitlementRetryPending, setRuntimeEntitlementRetryPending] =
    useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (showDevConsole === true) {
      // Explicitly show the inspector
      setShouldRenderInspector(true);
    } else if (showDevConsole === "auto") {
      // Show on localhost or 127.0.0.1 only
      const localhostHosts = new Set(["localhost", "127.0.0.1"]);
      if (localhostHosts.has(window.location.hostname)) {
        setShouldRenderInspector(true);
      } else {
        setShouldRenderInspector(false);
      }
    } else {
      // showDevConsole is false or undefined (default false)
      setShouldRenderInspector(false);
    }
  }, [showDevConsole]);

  // Normalize array props to stable references with clear dev warnings
  const renderToolCallsList = useStableArrayProp<ReactToolCallRenderer<any>>(
    renderToolCalls,
    "renderToolCalls must be a stable array. If you want to dynamically add or remove tools, use `useFrontendTool` instead.",
    (initial, next) => {
      // Only warn if the shape (names+agentId) changed. Allow identity changes
      // to support updated closures from parents (e.g., Storybook state).
      const key = (rc?: ReactToolCallRenderer<unknown>) =>
        `${rc?.agentId ?? ""}:${rc?.name ?? ""}`;
      const setFrom = (arr: ReactToolCallRenderer<unknown>[]) =>
        new Set(arr.map(key));
      const a = setFrom(initial);
      const b = setFrom(next);
      if (a.size !== b.size) return true;
      for (const k of a) if (!b.has(k)) return true;
      return false;
    },
  );

  const renderCustomMessagesList =
    useStableArrayProp<ReactCustomMessageRenderer>(
      renderCustomMessages,
      "renderCustomMessages must be a stable array.",
    );

  const renderActivityMessagesList = useStableArrayProp<
    ReactActivityMessageRenderer<any>
  >(renderActivityMessages, "renderActivityMessages must be a stable array.");

  // Built-in activity renderers that are always included
  const builtInActivityRenderers = useMemo<
    ReactActivityMessageRenderer<any>[]
  >(() => {
    const renderers: ReactActivityMessageRenderer<any>[] = [
      {
        activityType: MCPAppsActivityType,
        content: MCPAppsActivityContentSchema,
        render: MCPAppsActivityRenderer,
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
          catalog: a2ui?.catalog,
          loadingComponent: a2ui?.loadingComponent,
          recovery: a2ui?.recovery,
        }),
      );
    }

    return renderers;
  }, [a2uiActive, openGenUIActive, a2ui]);

  // Combine user-provided activity renderers with built-in ones
  // User-provided renderers take precedence (come first) so they can override built-ins
  const allActivityRenderers = useMemo(() => {
    return [...renderActivityMessagesList, ...builtInActivityRenderers];
  }, [renderActivityMessagesList, builtInActivityRenderers]);

  const resolvedPublicKey = publicApiKey ?? publicLicenseKey;
  const mergedAgents = useMemo(
    () => ({ ...agents, ...selfManagedAgents }),
    [agents, selfManagedAgents],
  );
  const hasLocalAgents = mergedAgents && Object.keys(mergedAgents).length > 0;

  // `selfManagedAgents` is part of CopilotKit's Enterprise Intelligence offering.
  // The signal is advisory and client-side only (not enforced): warn — in both
  // development and production — when it is used without a license key so
  // production usage is surfaced. `agents__unsafe_dev_only` is the free local-dev
  // escape hatch and is intentionally NOT gated here.
  const hasSelfManagedAgents = Object.keys(selfManagedAgents).length > 0;
  useEffect(() => {
    if (hasSelfManagedAgents && !resolvedPublicKey) {
      console.warn(
        "[CopilotKit] `selfManagedAgents` is part of CopilotKit's Enterprise " +
          "Intelligence offering. Provide a `publicLicenseKey` for production " +
          "use — contact the CopilotKit team about licensing.",
      );
    }
  }, [hasSelfManagedAgents, resolvedPublicKey]);

  // Resolve headers from function or static object
  const headers =
    typeof headersProp === "function" ? headersProp() : headersProp;

  // Merge a provided publicApiKey into headers (without overwriting an explicit header).
  const mergedHeaders = useMemo(() => {
    if (!resolvedPublicKey) return headers;
    if (headers[HEADER_NAME]) return headers;
    return {
      ...headers,
      [HEADER_NAME]: resolvedPublicKey,
    };
  }, [headers, resolvedPublicKey]);

  if (!runtimeUrl && !resolvedPublicKey && !hasLocalAgents) {
    const message =
      "Missing required prop: 'runtimeUrl' or 'publicApiKey' or 'publicLicenseKey'";
    if (process.env.NODE_ENV === "production") {
      throw new Error(message);
    } else {
      // In dev/test we warn but allow to facilitate local agents and unit tests.
      console.warn(message);
    }
  }

  const chatApiEndpoint =
    runtimeUrl ?? (resolvedPublicKey ? COPILOT_CLOUD_CHAT_URL : undefined);

  const frontendToolsList = useStableArrayProp<ReactFrontendTool>(
    frontendTools,
    "frontendTools must be a stable array. If you want to dynamically add or remove tools, use `useFrontendTool` instead.",
  );
  const humanInTheLoopList = useStableArrayProp<ReactHumanInTheLoop>(
    humanInTheLoop,
    "humanInTheLoop must be a stable array. If you want to dynamically add or remove human-in-the-loop tools, use `useHumanInTheLoop` instead.",
  );
  const sandboxFunctionsList = useStableArrayProp<SandboxFunction>(
    openGenerativeUI?.sandboxFunctions,
    "openGenerativeUI.sandboxFunctions must be a stable array.",
  );

  // Note: warnings for array identity changes are handled by useStableArrayProp

  // Process humanInTheLoop tools to create handlers and add render components
  const processedHumanInTheLoopTools = useMemo(() => {
    const processedTools: FrontendTool[] = [];
    const processedRenderToolCalls: ReactToolCallRenderer<unknown>[] = [];

    humanInTheLoopList.forEach((tool) => {
      // Create a promise-based handler for each human-in-the-loop tool
      const frontendTool: FrontendTool = {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        followUp: tool.followUp,
        ...(tool.agentId && { agentId: tool.agentId }),
        handler: async () => {
          // This handler will be replaced by the hook when it runs
          // For provider-level tools, we create a basic handler that waits for user interaction
          return new Promise((resolve) => {
            // The actual implementation will be handled by the render component
            // This is a placeholder that the hook will override
            console.warn(
              `Human-in-the-loop tool '${tool.name}' called but no interactive handler is set up.`,
            );
            resolve(undefined);
          });
        },
      };
      processedTools.push(frontendTool);

      // Add the render component to renderToolCalls
      if (tool.render) {
        processedRenderToolCalls.push({
          name: tool.name,
          args: tool.parameters,
          render: tool.render as React.ComponentType<any>,
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
        name: "generateSandboxedUi",
        description: GENERATE_SANDBOXED_UI_DESCRIPTION,
        parameters: GenerateSandboxedUiArgsSchema,
        handler: async () => "UI generated",
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
        // For wildcard tools without parameters, default to z.any()
        const args =
          tool.parameters || (tool.name === "*" ? z.any() : undefined);
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

  // Stable instance: created once for the provider lifetime.
  // Updates are applied via setter effects below rather than recreating the instance.
  const copilotkitRef = useRef<CopilotKitCoreReact | null>(null);
  if (copilotkitRef.current === null) {
    copilotkitRef.current = new CopilotKitCoreReact({
      runtimeUrl: chatApiEndpoint,
      // Defer the `/info` fetch out of construction. The core is constructed
      // during render, and React can start-and-discard renders (concurrent
      // rendering / Suspense / StrictMode) — a network request in the ctor
      // would fire once per discarded attempt (issue #5801). `connect()` below
      // starts the single request from a commit-phase effect.
      deferInitialConnection: true,
      runtimeTransport:
        useSingleEndpoint === true
          ? "single"
          : useSingleEndpoint === false
            ? "rest"
            : "auto",
      headers: mergedHeaders,
      credentials,
      properties,
      agents__unsafe_dev_only: mergedAgents,
      tools: allTools,
      renderToolCalls: allRenderToolCalls,
      renderActivityMessages: allActivityRenderers,
      renderCustomMessages: renderCustomMessagesList,
      debug,
    });
    // Set initial defaultThrottleMs synchronously so child hooks see the
    // correct value on their first render (before useEffect fires).
    if (defaultThrottleMs !== undefined) {
      copilotkitRef.current.setDefaultThrottleMs(defaultThrottleMs);
    }
  }
  const copilotkit = copilotkitRef.current;

  // Sync runtime feature flags from the core once runtime info is fetched.
  //
  // The core kicks off its `/info` fetch synchronously from its constructor
  // (during render), so `onRuntimeConnectionStatusChanged` can fire BEFORE this
  // passive effect runs and subscribes — especially on a cold first load
  // (incognito/hard refresh) where JS compile congestion delays the effect flush
  // past the `/info` resolution. If that happens, the settled values would be
  // lost forever. To close the race we read the CURRENT values immediately, so a
  // status that already resolved is captured whether or not we caught its event.
  // This MUST mirror the subscriber below (all five values), otherwise a missed
  // event leaves e.g. `licenseStatus` null indefinitely — which pins the threads
  // drawer to its "Loading threads…" state (licensePending never clears).
  useEffect(() => {
    const syncRuntimeInfo = () => {
      setRuntimeA2UIEnabled(copilotkit.a2uiEnabled);
      setRuntimeOpenGenUIEnabled(copilotkit.openGenerativeUIEnabled);
      setRuntimeLicenseStatus(copilotkit.licenseStatus);
      setRuntimeEntitlements(copilotkit.runtimeEntitlements);
      setRuntimeEntitlementRetryPending(
        copilotkit.runtimeEntitlementRetryPending,
      );
    };
    const subscription = copilotkit.subscribe({
      onRuntimeConnectionStatusChanged: syncRuntimeInfo,
    });
    // Catch-up read after subscribing, so a status that settled between the
    // subscribe call and now is still reflected.
    syncRuntimeInfo();
    return () => {
      subscription.unsubscribe();
    };
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

  // onError subscription — forward core errors to user callback
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    const subscription = copilotkit.subscribe({
      onError: (event) => {
        if (onErrorRef.current) {
          onErrorRef.current(event);
        } else {
          console.error(
            `[CopilotKit] Error (${event.code}):`,
            event.error,
            event.context ?? {},
          );
        }
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [copilotkit]);

  useEffect(() => {
    copilotkit.setRuntimeUrl(chatApiEndpoint);
    copilotkit.setRuntimeTransport(
      useSingleEndpoint === true
        ? "single"
        : useSingleEndpoint === false
          ? "rest"
          : "auto",
    );
    copilotkit.setHeaders(mergedHeaders);
    copilotkit.setCredentials(credentials);
    // Forward a per-run signal when the provider has an A2UI catalog so the
    // runtime can turn A2UI on (and inject the render tool) without a separate
    // `a2ui.injectA2UITool` flag on the runtime.
    copilotkit.setProperties(
      a2uiCatalogProvided
        ? { ...properties, a2uiCatalogAvailable: true }
        : properties,
    );
    copilotkit.setAgents__unsafe_dev_only(mergedAgents);
    copilotkit.setDebug(debug);
    // Start the runtime `/info` connection now that we're in the commit phase.
    // The ctor deferred it (see `deferInitialConnection` above) so discarded
    // renders never fetch; `connect()` is idempotent, so StrictMode's
    // double-invoked effect and re-runs on unrelated prop changes collapse to a
    // single request (a real runtimeUrl/transport change reconnects via the
    // setters above). See #5801.
    copilotkit.connect();
  }, [
    copilotkit,
    chatApiEndpoint,
    mergedHeaders,
    credentials,
    properties,
    a2uiCatalogProvided,
    mergedAgents,
    useSingleEndpoint,
    debug,
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
  // so it runs last in the effect queue on the initial mount cycle.
  useEffect(() => {
    didMountRef.current = true;
  }, []);

  // Sync defaultThrottleMs to the core instance on prop changes.
  // Initial value is set synchronously during instance creation (inside the
  // ref-init block above) so child hooks see the correct value on first render.
  // This effect handles subsequent updates when the prop changes.
  useEffect(() => {
    copilotkit.setDefaultThrottleMs(defaultThrottleMs);
  }, [copilotkit, defaultThrottleMs]);

  // Register design skill as agent context for the generateSandboxedUi tool
  const designSkill = openGenerativeUI?.designSkill ?? DEFAULT_DESIGN_SKILL;

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
        parameters: schemaToJsonSchema(fn.parameters, {
          zodToJsonSchema: zodToJsonSchemaAdapter,
        }),
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
    () => ({ copilotkit, executingToolCallIds }),
    [copilotkit, executingToolCallIds],
  );

  // License context — driven by server-reported authority via /info endpoint
  const retryableRuntimeEntitlementFailure =
    runtimeEntitlements?.status !== "ready" &&
    runtimeEntitlements?.error.retryable === true;
  const hasNonReadyRuntimeEntitlement =
    runtimeEntitlements !== undefined && runtimeEntitlements.status !== "ready";
  const hasLegacyRuntimeEntitlementFallback =
    runtimeLicenseStatus === "valid" || runtimeLicenseStatus === "expiring";
  const runtimeEntitlementRetryInProgress =
    retryableRuntimeEntitlementFailure &&
    runtimeEntitlementRetryPending &&
    !hasLegacyRuntimeEntitlementFallback;
  const runtimeEntitlementFailureSettled =
    hasNonReadyRuntimeEntitlement &&
    !runtimeEntitlementRetryInProgress &&
    !hasLegacyRuntimeEntitlementFallback;
  const runtimeLicenseWarningStatus = runtimeEntitlementRetryInProgress
    ? undefined
    : runtimeLicenseStatus;
  const licenseContextValue = useMemo<LicenseContextValue>(() => {
    const runtimeLicenseContext = createLicenseContextValue(
      runtimeEntitlementRetryInProgress ? undefined : runtimeLicenseStatus,
      runtimeEntitlements,
    );
    if (!runtimeEntitlementFailureSettled) {
      return runtimeLicenseContext;
    }

    // The Runtime has neither managed authority nor a usable legacy fallback.
    // Keep its truthful status, but deny feature-only consumers.
    return {
      ...runtimeLicenseContext,
      checkFeature: () => false,
      getLimit: () => null,
    };
  }, [
    runtimeEntitlementFailureSettled,
    runtimeEntitlementRetryInProgress,
    runtimeEntitlements,
    runtimeLicenseStatus,
  ]);

  return (
    <SandboxFunctionsContext.Provider value={sandboxFunctionsList}>
      <CopilotKitContext.Provider value={contextValue}>
        <LicenseContext.Provider value={licenseContextValue}>
          {a2uiActive && <A2UIBuiltInToolCallRenderer />}
          {a2uiActive && (
            <A2UICatalogContext
              catalog={a2ui?.catalog}
              includeSchema={a2ui?.includeSchema}
            />
          )}
          {children}
          {shouldRenderInspector ? (
            <CopilotKitInspector
              core={copilotkit}
              defaultAnchor={inspectorDefaultAnchor}
            />
          ) : null}
          {/* License warnings — driven by server-reported status */}
          {runtimeLicenseWarningStatus === "none" && !resolvedPublicKey && (
            <LicenseWarningBanner type="no_license" />
          )}
          {runtimeLicenseWarningStatus === "expired" && (
            <LicenseWarningBanner type="expired" />
          )}
          {runtimeLicenseWarningStatus === "invalid" && (
            <LicenseWarningBanner type="invalid" />
          )}
          {runtimeLicenseWarningStatus === "expiring" && (
            <LicenseWarningBanner type="expiring" />
          )}
        </LicenseContext.Provider>
      </CopilotKitContext.Provider>
    </SandboxFunctionsContext.Provider>
  );
};

// Re-export useCopilotKit from context for backward compatibility
export { useCopilotKit } from "../context";
