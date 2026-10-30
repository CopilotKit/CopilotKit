"use client";

import { randomUUID } from "@copilotkit/shared";
import type { AbstractAgent } from "@ag-ui/client";
import type {
  CopilotKitMessageFilter,
  FrontendTool,
  LearningConfig,
} from "@copilotkit/core";
import { ToolCallStatus } from "@copilotkit/core";
import type React from "react";
import {
  createElement,
  useMemo,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
// Context extracted to ../context.ts for cross-platform reuse (React Native).
// `CopilotKitCoreReact` comes from there too, so the headless build keeps it
// external instead of inlining a second copy of the class.
import {
  CopilotKitAgentIdContext,
  CopilotKitContext,
  CopilotKitCoreReact,
  LicenseContext,
} from "../context";
import type { CopilotKitContextValue } from "../context";
import { z } from "zod";
import { createLicenseContextValue } from "@copilotkit/shared";
import type {
  LicenseContextValue,
  DebugConfig,
  RuntimeEntitlementResponse,
  RuntimeLicenseStatus,
} from "@copilotkit/shared";
import type {
  CopilotKitCoreErrorCode,
  CopilotKitHeadersSource,
} from "@copilotkit/core";
import { ɵwithHeaderDefaults } from "@copilotkit/core";
import type {
  ReactActivityMessageRenderer,
  ReactToolCallRenderer,
} from "../types";
import type { ReactFrontendTool } from "../types/frontend-tool";
import type { ReactHumanInTheLoop } from "../types/human-in-the-loop";
import type { ReactCustomMessageRenderer } from "../types/react-custom-message-renderer";

const HEADER_NAME = "X-CopilotCloud-Public-Api-Key";
const COPILOT_CLOUD_CHAT_URL = "https://api.cloud.copilotkit.ai/copilotkit/v1";
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
const EMPTY_TOOLS: ReactFrontendTool[] = [];
const EMPTY_ACTIVITY_RENDERERS: ReactActivityMessageRenderer<any>[] = [];

/**
 * The runtime feature flags from `/info` that the `/v2` provider's built-in
 * renderers depend on.
 *
 * @internal
 */
export interface ɵCopilotKitRuntimeFeatures {
  a2uiEnabled: boolean;
  openGenerativeUIEnabled: boolean;
}

/**
 * What `ɵextend` adds to the headless provider.
 *
 * @internal
 */
export interface ɵCopilotKitHeadlessProviderExtension {
  /** Registered after `frontendTools` and before `humanInTheLoop`. */
  tools?: ReactFrontendTool[];
  /** Registered after `renderActivityMessages`, so the caller's renderers win. */
  renderActivityMessages?: ReactActivityMessageRenderer<any>[];
  /** Merged over `properties`. */
  properties?: Record<string, unknown>;
  /** Rendered inside the provider's contexts, before `children`. */
  children?: ReactNode;
}

export interface CopilotKitHeadlessProviderProps {
  children: ReactNode;
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
   * ```tsx
   * <CopilotKit
   *   runtimeUrl="/api/copilotkit"
   *   messageFilter={(messages) => messages.slice(-1)}
   * />
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
   * Prefer a stable reference (`useCallback`). An inline arrow re-registers the
   * filter on every render, which is harmless but needless.
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
  properties?: Record<string, unknown>;
  /**
   * The id of the agent every `<CopilotChat>` under this provider talks to,
   * unless a chat names its own with the `agentId` prop.
   *
   * This is the v2 replacement for the v1 `<CopilotKit agent="...">` prop. Set
   * it here and you never need the v1 compatibility provider just to name an
   * agent. Defaults to `"default"`.
   */
  agentId?: string;
  useSingleEndpoint?: boolean;
  agents__unsafe_dev_only?: Record<string, AbstractAgent>;
  selfManagedAgents?: Record<string, AbstractAgent>;
  renderToolCalls?: ReactToolCallRenderer<any>[];
  renderActivityMessages?: ReactActivityMessageRenderer<any>[];
  renderCustomMessages?: ReactCustomMessageRenderer[];
  frontendTools?: ReactFrontendTool[];
  humanInTheLoop?: ReactHumanInTheLoop[];
  /**
   * Whether to automatically mount the Intelligence indicator in chat.
   *
   * @default true
   */
  showIntelligenceIndicator?: boolean;
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
   * Default throttle interval (in milliseconds) for `useAgent` re-renders
   * triggered by `OnMessagesChanged` notifications. This value is used as
   * a fallback when neither the `useAgent()` hook nor `<CopilotChat>` /
   * `<CopilotSidebar>` / `<CopilotPopup>` specify an explicit `throttleMs`.
   *
   * @default undefined (components/hooks without an explicit throttleMs will be unthrottled)
   */
  defaultThrottleMs?: number;
  /**
   * Enable debug logging for the client-side event pipeline.
   */
  debug?: DebugConfig;
  /**
   * Turns on interaction capture (`@copilotkit/learning`). `learning` (short
   * for `learning={true}`) records with the default options; pass an object
   * for options. `false` or omitting the prop turns capture off and cancels
   * startup. Without a sink, Core authenticates with the runtime and sends
   * browser events to Intelligence; a custom sink keeps the standalone
   * collector behavior. Updated settings apply to the next Trajectory.
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
   *
   * @example
   * <CopilotKitProvider runtimeUrl="/api/copilotkit" learning>
   */
  learning?: boolean | LearningProp;
  /**
   * Internal: how `CopilotKitProvider` from `/v2` adds its built-in tools,
   * renderers and properties. They are part of the core's constructor
   * arguments, so child hooks' registrations are not overwritten on mount.
   *
   * Called during render, and again when the function or the runtime flags
   * change. `core` is `null` on the first render, before the instance exists.
   *
   * @internal
   */
  ɵextend?: (
    core: CopilotKitCoreReact | null,
    runtime: ɵCopilotKitRuntimeFeatures,
  ) => ɵCopilotKitHeadlessProviderExtension;
}

type LearningProp = LearningConfig & {
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
export function useStableArrayProp<T>(
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

/**
 * Provide a shared core instance and synchronize runtime, tool, and context
 * configuration, without any built-in UI. For apps that render their own chat
 * UI: it keeps the chat components and their rendering stack out of the
 * bundle. `CopilotKitProvider` from `/v2` wraps it and adds the built-in
 * renderers, the Inspector and the license banner.
 */
export const CopilotKitHeadlessProvider: React.FC<
  CopilotKitHeadlessProviderProps
> = ({
  children,
  runtimeUrl,
  headers: headersProp = EMPTY_HEADERS,
  credentials,
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
  frontendTools,
  humanInTheLoop,
  agentId,
  showIntelligenceIndicator = true,
  useSingleEndpoint,
  onError,
  defaultThrottleMs,
  debug,
  learning,
  ɵextend,
}) => {
  // Memoized so a stable `learning` object keeps a stable config after
  // `autoStart` is removed.
  const learningConfig = useMemo(() => toLearningConfig(learning), [learning]);

  const [runtimeA2UIEnabled, setRuntimeA2UIEnabled] = useState(false);
  const [runtimeOpenGenUIEnabled, setRuntimeOpenGenUIEnabled] = useState(false);
  const [runtimeLicenseStatus, setRuntimeLicenseStatus] = useState<
    RuntimeLicenseStatus | undefined
  >(undefined);
  const [runtimeEntitlements, setRuntimeEntitlements] = useState<
    RuntimeEntitlementResponse | undefined
  >(undefined);
  const [runtimeEntitlementRetryPending, setRuntimeEntitlementRetryPending] =
    useState(false);

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

  // Stable core instance ref, declared here (before the extension memo) so
  // `ɵextend` can read the current instance. The instance itself is created in
  // the ref-init block below; on the very first render `current` is still null.
  const copilotkitRef = useRef<CopilotKitCoreReact | null>(null);

  const extension = useMemo(
    () =>
      ɵextend?.(copilotkitRef.current, {
        a2uiEnabled: runtimeA2UIEnabled,
        openGenerativeUIEnabled: runtimeOpenGenUIEnabled,
      }),
    [ɵextend, runtimeA2UIEnabled, runtimeOpenGenUIEnabled],
  );
  const extensionTools = extension?.tools ?? EMPTY_TOOLS;
  const extensionActivityRenderers =
    extension?.renderActivityMessages ?? EMPTY_ACTIVITY_RENDERERS;
  const extensionProperties = extension?.properties;

  // Combine user-provided activity renderers with the extension's built-ins
  // User-provided renderers take precedence (come first) so they can override built-ins
  const allActivityRenderers = useMemo(() => {
    return [...renderActivityMessagesList, ...extensionActivityRenderers];
  }, [renderActivityMessagesList, extensionActivityRenderers]);

  const resolvedPublicKey = publicApiKey ?? publicLicenseKey;
  const mergedAgents = useMemo(
    () => ({ ...agents, ...selfManagedAgents }),
    [agents, selfManagedAgents],
  );
  const hasLocalAgents = mergedAgents && Object.keys(mergedAgents).length > 0;

  // `selfManagedAgents` is part of CopilotKit's Enterprise Intelligence tier.
  // The signal is advisory and client-side only (not enforced): warn — in both
  // development and production — when it is used without a license key so
  // production usage is surfaced. `agents__unsafe_dev_only` is the free local-dev
  // escape hatch and is intentionally NOT gated here.
  const hasSelfManagedAgents = Object.keys(selfManagedAgents).length > 0;
  useEffect(() => {
    if (hasSelfManagedAgents && !resolvedPublicKey) {
      console.warn(
        "[CopilotKit] `selfManagedAgents` is part of CopilotKit's Enterprise " +
          "Intelligence tier. Provide a `publicLicenseKey` for production " +
          "use — contact the CopilotKit team about licensing.",
      );
    }
  }, [hasSelfManagedAgents, resolvedPublicKey]);

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
        resolvedPublicKey ? { [HEADER_NAME]: resolvedPublicKey } : {},
      ),
    [headersInput, resolvedPublicKey],
  );

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
    "humanInTheLoop must be a stable array. If you want to dynamically add or remove human-in-the-loop tools, use `useHumanInTheLoop` instead.",
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

  // Combine all tools for CopilotKitCore
  const allTools = useMemo(() => {
    const tools: FrontendTool[] = [];

    // Add frontend tools (user-provided + extension)
    tools.push(...frontendToolsList);
    tools.push(...extensionTools);

    // Add processed human-in-the-loop tools
    tools.push(...processedHumanInTheLoopTools.tools);

    return tools;
  }, [frontendToolsList, extensionTools, processedHumanInTheLoopTools]);

  // Combine all render tool calls
  const allRenderToolCalls = useMemo(() => {
    const combined: ReactToolCallRenderer<unknown>[] = [...renderToolCallsList];

    // Add render components from frontend tools (user-provided + extension)
    [...frontendToolsList, ...extensionTools].forEach((tool) => {
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
    extensionTools,
    processedHumanInTheLoopTools,
  ]);

  // Stable instance: created once for the provider lifetime (ref declared above
  // so `ɵextend` can read it).
  // Updates are applied via setter effects below rather than recreating the instance.
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
      headers: headersSource,
      credentials,
      messageFilter,
      properties,
      agents__unsafe_dev_only: mergedAgents,
      tools: allTools,
      renderToolCalls: allRenderToolCalls,
      renderActivityMessages: allActivityRenderers,
      renderCustomMessages: renderCustomMessagesList,
      debug,
      learning: learningConfig,
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

  const providerProperties = useMemo(
    () =>
      extensionProperties
        ? { ...properties, ...extensionProperties }
        : properties,
    [properties, extensionProperties],
  );

  // Declared before the effect that calls `connect()` so React runs it first:
  // an agent discovered by that connection is then constructed with the filter
  // already in place, rather than making its first run with the full thread.
  useEffect(() => {
    copilotkit.setMessageFilter(messageFilter);
  }, [copilotkit, messageFilter]);

  useEffect(() => {
    copilotkit.setRuntimeUrl(chatApiEndpoint);
    copilotkit.setRuntimeTransport(
      useSingleEndpoint === true
        ? "single"
        : useSingleEndpoint === false
          ? "rest"
          : "auto",
    );
    copilotkit.setHeaders(headersSource);
    copilotkit.setCredentials(credentials);
    // Properties from `ɵextend` go over the caller's (the `/v2` provider's
    // A2UI catalog signal, for example).
    //
    // The generative UI envelope is not in these properties: useGenerativeUIRoot
    // adds it as scoped properties, so this call does not replace it.
    copilotkit.setProperties(providerProperties);
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
    headersSource,
    credentials,
    providerProperties,
    mergedAgents,
    useSingleEndpoint,
    debug,
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

  const contextValue = useMemo<CopilotKitContextValue>(
    () => ({
      copilotkit,
      executingToolCallIds,
      showIntelligenceIndicator,
    }),
    [copilotkit, executingToolCallIds, showIntelligenceIndicator],
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
  // Only a terminal failure denies features. A retryable failure (a timeout,
  // a network error, a 5xx) says nothing about what the project may use.
  const terminalRuntimeEntitlementFailure =
    hasNonReadyRuntimeEntitlement &&
    !retryableRuntimeEntitlementFailure &&
    !hasLegacyRuntimeEntitlementFallback;
  const licenseContextValue = useMemo<LicenseContextValue>(() => {
    const runtimeLicenseContext = createLicenseContextValue(
      runtimeEntitlementRetryInProgress ? undefined : runtimeLicenseStatus,
      runtimeEntitlements,
    );
    if (!terminalRuntimeEntitlementFailure) {
      return runtimeLicenseContext;
    }

    // The Runtime reported a terminal failure and has no usable legacy fallback.
    // Keep its truthful status, but deny feature-only consumers.
    return {
      ...runtimeLicenseContext,
      checkFeature: () => false,
      getLimit: () => null,
    };
  }, [
    terminalRuntimeEntitlementFailure,
    runtimeEntitlementRetryInProgress,
    runtimeEntitlements,
    runtimeLicenseStatus,
  ]);

  return (
    <CopilotKitContext.Provider value={contextValue}>
      <LicenseContext.Provider value={licenseContextValue}>
        {extension?.children}
        {/*
          Publish the provider-level agent default. This is a bare string
          context, NOT a `CopilotChatConfigurationProvider`: that provider
          also owns a thread, so wrapping the application in one would give
          every descendant chat the same inherited threadId. See the
          `CopilotKitAgentIdContext` comment in `../context`.
        */}
        <CopilotKitAgentIdContext.Provider value={agentId}>
          {children}
        </CopilotKitAgentIdContext.Provider>
      </LicenseContext.Provider>
    </CopilotKitContext.Provider>
  );
};
