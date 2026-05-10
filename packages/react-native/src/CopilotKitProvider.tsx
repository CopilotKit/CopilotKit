import React, {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CopilotKitContext,
  type CopilotKitContextValue,
  LicenseContext,
} from "@copilotkit/react-core/v2/context";
import { CopilotKitCoreReact } from "@copilotkit/react-core/v2/headless";
import type { CopilotKitCoreErrorCode } from "@copilotkit/core";

export interface CopilotKitNativeProviderProps {
  children: ReactNode;
  /** URL of the CopilotKit runtime endpoint */
  runtimeUrl: string;
  /** Custom headers sent with every request */
  headers?: Record<string, string>;
  /** Whether the runtime uses a single-route endpoint */
  useSingleEndpoint?: boolean;
  /** Custom properties forwarded to agents */
  properties?: Record<string, unknown>;
  /**
   * Error handler called when CopilotKit encounters an error.
   * Fires for all error types (runtime connection failures, agent errors, tool errors).
   * If not provided, errors are logged to console.error.
   */
  onError?: (event: {
    error: Error;
    code: CopilotKitCoreErrorCode;
    context: Record<string, any>;
  }) => void;
}

/**
 * CopilotKit provider for React Native.
 *
 * A lightweight alternative to the web CopilotKitProvider that avoids
 * web-only dependencies (DOM, CSS, Radix UI, Lit, etc).
 *
 * Usage:
 * ```tsx
 * import "@copilotkit/react-native/polyfills";
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
  headers,
  useSingleEndpoint,
  properties,
  onError,
}) => {
  // Stabilize headers/properties references to avoid effect churn when callers
  // pass inline object literals (e.g. headers={{}} or the undefined default).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableHeaders = useMemo(() => headers ?? {}, [JSON.stringify(headers)]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableProperties = useMemo(
    () => properties ?? {},
    [JSON.stringify(properties)],
  );

  const copilotkitRef = useRef<CopilotKitCoreReact | null>(null);

  if (copilotkitRef.current === null) {
    copilotkitRef.current = new CopilotKitCoreReact({
      runtimeUrl,
      runtimeTransport:
        useSingleEndpoint === true
          ? "single"
          : useSingleEndpoint === false
            ? "rest"
            : "auto",
      headers: stableHeaders,
      properties: stableProperties,
    });
  }

  const copilotkit = copilotkitRef.current;

  // Sync props to core instance
  useEffect(() => {
    copilotkit.setRuntimeUrl(runtimeUrl);
    copilotkit.setRuntimeTransport(
      useSingleEndpoint === true
        ? "single"
        : useSingleEndpoint === false
          ? "rest"
          : "auto",
    );
    copilotkit.setHeaders(stableHeaders);
    copilotkit.setProperties(stableProperties);
  }, [
    runtimeUrl,
    useSingleEndpoint,
    stableHeaders,
    stableProperties,
    copilotkit,
  ]);

  // Track executing tool call IDs at the provider level.
  // Critical for HITL reconnection: onToolExecutionStart fires before child
  // components mount, so we must capture the state here.
  const [executingToolCallIds, setExecutingToolCallIds] = useState<
    ReadonlySet<string>
  >(() => new Set());

  // Use ref to avoid subscription churn when onError changes
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Single subscription for tool execution tracking and error handling.
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
    return () => subscription.unsubscribe();
  }, [copilotkit]);

  const contextValue: CopilotKitContextValue = useMemo(
    () => ({
      copilotkit,
      executingToolCallIds,
    }),
    [copilotkit, executingToolCallIds],
  );

  const licenseContextValue = useMemo(
    () => ({
      status: null as null,
      license: null as null,
      checkFeature: () => true,
      getLimit: () => null,
    }),
    [],
  );

  return (
    <CopilotKitContext.Provider value={contextValue}>
      <LicenseContext.Provider value={licenseContextValue}>
        {children}
      </LicenseContext.Provider>
    </CopilotKitContext.Provider>
  );
};
