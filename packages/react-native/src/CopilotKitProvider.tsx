import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  CopilotKitContext,
  LicenseContext,
} from "@copilotkit/react-core/context";
import type {
  CopilotKitContextValue,
  CopilotKitCoreReact as CopilotKitCoreReactInstance,
} from "@copilotkit/react-core/context";
import {
  CopilotKitCoreReact,
  ɵuseOwnedCore,
} from "@copilotkit/react-core/headless";
import type {
  ɵCopilotKitProviderBaseOptions,
  ɵRuntimeInfo,
} from "@copilotkit/core";
import {
  ɵreportProviderConfigDiagnostics,
  ɵresolveProviderConfig,
} from "@copilotkit/core";
import { createLicenseContextValue } from "@copilotkit/shared";
import { MarkdownRendererProvider } from "./components/MarkdownRendererContext";
import type { MarkdownRendererValue } from "./components/MarkdownRendererContext";

export interface CopilotKitNativeProviderProps extends Pick<
  ɵCopilotKitProviderBaseOptions,
  | "credentials"
  | "messageFilter"
  | "useSingleEndpoint"
  | "properties"
  | "onError"
  | "debug"
  | "defaultThrottleMs"
> {
  children: ReactNode;
  /** URL of the CopilotKit runtime endpoint */
  runtimeUrl: string;
  /** Custom headers sent with every request */
  headers?: Record<string, string> | (() => Record<string, string>);
  /**
   * Custom markdown renderer for assistant messages. Either a component (escape
   * hatch — receives `content` and an optional `isStreaming` flag) used instead
   * of the built-in renderer, or a `{ style, animate }` config object to
   * configure the built-in React Native renderer (the `CopilotMarkdown` used by
   * the default `AssistantMessage`) without writing a wrapper.
   */
  markdownRenderer?: MarkdownRendererValue;
  // Cloud features (publicApiKey, licenseToken) — not yet supported on React Native
}

/**
 * CopilotKit provider for React Native.
 *
 * A lightweight alternative to the web CopilotKitProvider that avoids
 * web-only dependencies (DOM, CSS, Radix UI, Lit, etc).
 *
 * Polyfills are auto-imported when `@copilotkit/react-native` is loaded,
 * so a separate `import "@copilotkit/react-native/polyfills"` is no longer
 * required (though it remains available for advanced use).
 *
 * Usage:
 * ```tsx
 * import { CopilotKitProvider } from "@copilotkit/react-native";
 *
 * function App() {
 *   return (
 *     <CopilotKitProvider runtimeUrl="https://your-runtime/api/copilotkit">
 *       <ChatScreen />
 *     </CopilotKitProvider>
 *   );
 * }
 * ```
 */
export const CopilotKitProvider: React.FC<CopilotKitNativeProviderProps> = ({
  children,
  runtimeUrl,
  headers: headersProp,
  credentials,
  messageFilter,
  useSingleEndpoint,
  properties,
  onError,
  debug,
  defaultThrottleMs,
  markdownRenderer,
}) => {
  // Resolve headers from function or static object (matches web provider pattern)
  const resolvedHeaders =
    typeof headersProp === "function" ? headersProp() : headersProp;

  // Stabilize headers/properties references to avoid effect churn when callers
  // pass inline object literals (e.g. headers={{}} or the undefined default).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableHeaders = useMemo(
    () => resolvedHeaders ?? {},
    [JSON.stringify(resolvedHeaders)],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableProperties = useMemo(
    () => properties ?? {},
    [JSON.stringify(properties)],
  );

  // Transport mapping and config checks come from core.
  const resolvedConfig = useMemo(
    () =>
      ɵresolveProviderConfig({
        runtimeUrl,
        useSingleEndpoint,
        properties: stableProperties,
      }),
    [runtimeUrl, useSingleEndpoint, stableProperties],
  );
  const loggedDiagnosticsRef = useRef(new Set<string>());
  ɵreportProviderConfigDiagnostics(resolvedConfig.diagnostics, {
    isProduction: process.env.NODE_ENV === "production",
    logged: loggedDiagnosticsRef.current,
  });

  // One core for the provider lifetime, disposed on unmount (StrictMode
  // safe, see `ɵuseOwnedCore`).
  const copilotkitRef = useRef<CopilotKitCoreReactInstance | null>(null);
  const copilotkit = ɵuseOwnedCore(
    copilotkitRef,
    (): CopilotKitCoreReactInstance =>
      new CopilotKitCoreReact({
        runtimeUrl: resolvedConfig.runtimeUrl,
        runtimeTransport: resolvedConfig.runtimeTransport,
        // `/info` starts from the effect below, so a render React discards
        // never fetches it (#5801).
        deferInitialConnection: true,
        headers: stableHeaders,
        credentials,
        messageFilter,
        properties: resolvedConfig.properties,
        debug,
        // Set at construction so child hooks see it on their first render.
        defaultThrottleMs,
        onError,
      }),
  );

  // Core calls `onError`, and logs the error itself when there is none.
  useEffect(() => {
    copilotkit.setErrorHandler(onError);
  }, [copilotkit, onError]);

  // Sync props to the core. Core applies only what changed.
  useEffect(() => {
    copilotkit.ɵupdateConfig({
      messageFilter,
      runtimeUrl: resolvedConfig.runtimeUrl,
      runtimeTransport: resolvedConfig.runtimeTransport,
      headers: stableHeaders,
      credentials,
      properties: resolvedConfig.properties,
      debug,
      defaultThrottleMs,
    });
    copilotkit.connect();
  }, [
    copilotkit,
    messageFilter,
    resolvedConfig.runtimeUrl,
    resolvedConfig.runtimeTransport,
    stableHeaders,
    credentials,
    resolvedConfig.properties,
    debug,
    defaultThrottleMs,
  ]);

  // Track executing tool call IDs at the provider level.
  // Critical for HITL reconnection: onToolExecutionStart fires before child
  // components mount, so we must capture the state here.
  const [executingToolCallIds, setExecutingToolCallIds] = useState<
    ReadonlySet<string>
  >(() => new Set());

  const [runtimeInfo, setRuntimeInfo] = useState<ɵRuntimeInfo | null>(null);
  const runtimeLicenseStatus = runtimeInfo?.licenseStatus;

  // Project core's runtime info snapshot; the catch-up read reflects a status
  // that settled before this effect ran.
  useEffect(() => {
    const syncRuntimeInfo = () => setRuntimeInfo(copilotkit.ɵruntimeInfo);
    const unsubscribe = copilotkit.ɵsubscribeToRuntimeInfo(syncRuntimeInfo);
    syncRuntimeInfo();
    return unsubscribe;
  }, [copilotkit]);

  // Tool execution tracking.
  // Tool call IDs are tracked at the provider level because onToolExecutionStart
  // fires before child components mount — critical for HITL reconnection.
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
    return () => subscription.unsubscribe();
  }, [copilotkit]);

  const contextValue: CopilotKitContextValue = useMemo(
    () => ({
      copilotkit,
      executingToolCallIds,
    }),
    [copilotkit, executingToolCallIds],
  );

  // License context — driven by server-reported status via /info endpoint
  const licenseContextValue = useMemo(
    () => createLicenseContextValue(runtimeLicenseStatus),
    [runtimeLicenseStatus],
  );

  return (
    <CopilotKitContext.Provider value={contextValue}>
      <LicenseContext.Provider value={licenseContextValue}>
        <MarkdownRendererProvider renderer={markdownRenderer}>
          {children}
        </MarkdownRendererProvider>
      </LicenseContext.Provider>
    </CopilotKitContext.Provider>
  );
};
