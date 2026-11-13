import React, { createContext, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useCopilotKit } from "@copilotkit/react-core/v2/context";
import {
  GenerativeUIHostContext,
  GenerativeUIRuntimeContext,
  GenerativeUIToolCallRenderer,
  useGenerativeUIRoot,
} from "@copilotkit/react-core/v2/generative-ui/native";
import type {
  GenerativeUIHost,
  GenerativeUIToolConfig as WebGenerativeUIToolConfig,
} from "@copilotkit/react-core/v2/generative-ui/native";
import { nativeGenerativeUIHost } from "./host";
import {
  describeValue,
  isDevelopment,
  useDevelopmentWarnings,
} from "./internal";

/**
 * The number of mounted providers with a `ui`, by CopilotKit core. Each one
 * sets the generative UI of every run on its core, so two of them override
 * each other.
 */
const mountedRoots = new WeakMap<object, number>();

/**
 * The generative UI config of React Native: the web tool transport's config
 * without `theme`. On the web, `theme` sets the `--a2ui-*` CSS variables of
 * the surfaces. React Native has no CSS variables, so the option is left out
 * of the type rather than silently ignored. Style your catalog's components
 * directly.
 */
export type GenerativeUIToolConfig = Omit<WebGenerativeUIToolConfig, "theme">;

/**
 * The props of {@link GenerativeUIProvider}: {@link GenerativeUIToolConfig},
 * the children and the host elements.
 *
 * A `theme` or a `transport` other than `"tool"` that gets past the type (from
 * JavaScript, or through a cast) is dropped before it reaches the runtime, with
 * a warning in development: the surfaces never get a theme, and the transport
 * is always the tool transport.
 */
export type GenerativeUIProviderProps = GenerativeUIToolConfig & {
  children: ReactNode;
  /**
   * The host elements around the catalog's components: the surface root, the
   * accessibility wrapper and the error fallback. Defaults to React Native
   * views.
   */
  host?: GenerativeUIHost;
};

/**
 * Whether a `GenerativeUIProvider` is above, so the components below can tell
 * "no provider" from "a provider without `ui`" (the runtime is null in both).
 */
export const GenerativeUIProviderPresentContext = createContext(false);

/**
 * Experimental. Turns on generative UI for the agents of the enclosing
 * `CopilotKitProvider`: the agent renders the components of `ui` (from
 * `createGenerativeUI`) with the `render_ui` tool. Place it inside
 * `CopilotKitProvider`. It applies to every agent run on that CopilotKit
 * core, wherever the run starts in the component tree; limit it to some
 * agents with `agentIds`. Show what the agent
 * renders with `<GenerativeUIActivity>` (any activity message, for example in
 * your own chat list or on a home screen) or `<GenerativeUISurface id>` (a
 * named place in your app).
 *
 * The runtime needs no setup: `CopilotRuntime` adds the `render_ui` tool to
 * the run when the app sends a catalog with at least one component. A
 * catalog with no components gets no `render_ui` tool.
 *
 * Mount exactly one `GenerativeUIProvider` with a `ui` for each
 * `CopilotKitProvider`, above every screen that shows generative UI, rather
 * than one per screen. Each one sets the catalog and the named targets of
 * every run on the core, so two of them override each other, and each
 * shows only the surfaces built for its own catalog. In development, the
 * second one mounted warns.
 *
 * It ingests every generative UI activity message in the messages of the
 * agents it watches. A message whose content is malformed is skipped (in
 * development it warns once for each distinct issue), as
 * `<GenerativeUIActivity>` skips it.
 *
 * @example
 * ```tsx
 * const ui = createGenerativeUI({
 *   id: "bank",
 *   components: {
 *     BalanceCard: {
 *       description: "An account balance",
 *       props: z.object({ accountId: z.string() }),
 *       component: BalanceCard,
 *     },
 *   },
 * });
 *
 * <CopilotKitProvider runtimeUrl={RUNTIME_URL}>
 *   <GenerativeUIProvider ui={ui}>
 *     <App />
 *   </GenerativeUIProvider>
 * </CopilotKitProvider>
 * ```
 */
export function GenerativeUIProvider({
  children,
  host = nativeGenerativeUIHost,
  ...props
}: GenerativeUIProviderProps) {
  // Untyped callers can still pass these. Neither reaches the runtime.
  const {
    theme,
    transport: requestedTransport,
    ...config
  } = props as GenerativeUIToolConfig & {
    theme?: unknown;
    transport?: unknown;
  };
  const hasTheme = theme !== undefined;
  const otherTransport =
    requestedTransport === undefined || requestedTransport === "tool"
      ? undefined
      : describeValue(requestedTransport);
  const hasUI = config.ui !== undefined && config.ui !== null;
  useDevelopmentWarnings([
    hasTheme
      ? "[generativeUI] <GenerativeUIProvider> ignores `theme`: React Native has no CSS variables. Style the components of your catalog instead."
      : undefined,
    otherTransport !== undefined
      ? `[generativeUI] <GenerativeUIProvider> ignores transport ${otherTransport}: React Native supports only the tool transport.`
      : undefined,
    hasUI
      ? undefined
      : "[generativeUI] <GenerativeUIProvider> has no `ui`, so generative UI is off: pass the result of createGenerativeUI.",
  ]);
  const { copilotkit } = useCopilotKit();
  const runtime = useGenerativeUIRoot(copilotkit, {
    ...config,
    transport: "tool",
  });
  const isRoot = runtime !== null;
  const warnedShared = useRef(false);
  useEffect(() => {
    if (!isRoot) return;
    const count = (mountedRoots.get(copilotkit) ?? 0) + 1;
    mountedRoots.set(copilotkit, count);
    if (count > 1 && !warnedShared.current && isDevelopment()) {
      warnedShared.current = true;
      console.warn(
        "[generativeUI] more than one <GenerativeUIProvider> with a `ui` is mounted under one CopilotKitProvider. Each one sets the catalog and the targets of every agent run on that core, so they override each other. Mount one <GenerativeUIProvider> for each CopilotKitProvider, above every screen that shows generative UI.",
      );
    }
    return () => {
      mountedRoots.set(copilotkit, (mountedRoots.get(copilotkit) ?? 1) - 1);
    };
  }, [copilotkit, isRoot]);
  return (
    <GenerativeUIProviderPresentContext.Provider value={true}>
      <GenerativeUIRuntimeContext.Provider value={runtime}>
        <GenerativeUIHostContext.Provider value={host}>
          {runtime ? <GenerativeUIToolCallRenderer /> : null}
          {children}
        </GenerativeUIHostContext.Provider>
      </GenerativeUIRuntimeContext.Provider>
    </GenerativeUIProviderPresentContext.Provider>
  );
}
