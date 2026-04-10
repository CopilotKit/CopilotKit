import React, { type ReactNode, useEffect, useMemo, useRef } from "react";
import {
  CopilotKitContext,
  type CopilotKitContextValue,
  EMPTY_SET,
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
  headers = {},
  useSingleEndpoint = true,
  properties = {},
  onError,
}) => {
  const copilotkitRef = useRef<CopilotKitCoreReact | null>(null);

  if (copilotkitRef.current === null) {
    copilotkitRef.current = new CopilotKitCoreReact({
      runtimeUrl,
      runtimeTransport: useSingleEndpoint ? "single" : "rest",
      headers,
      properties,
    });
  }

  const copilotkit = copilotkitRef.current;

  // Sync props to core instance
  useEffect(() => {
    copilotkit.setRuntimeUrl(runtimeUrl);
    copilotkit.setRuntimeTransport(useSingleEndpoint ? "single" : "rest");
    copilotkit.setHeaders(headers);
    copilotkit.setProperties(properties);
  }, [runtimeUrl, useSingleEndpoint, headers, properties, copilotkit]);

  // Issue 7: Use ref to avoid subscription churn when onError changes
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Issue 3: Always subscribe — fall back to console.error when no onError provided
  // Issue 6: Forward full error event (error, code, context) matching web provider signature
  useEffect(() => {
    const subscription = copilotkit.subscribe({
      onError: (event) => {
        if (onErrorRef.current) {
          onErrorRef.current({
            error: event.error,
            code: event.code,
            context: event.context,
          });
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

  // Issue 8: The headless bundle inlines @copilotkit/core, producing a distinct
  // TS declaration for CopilotKitCoreReact. At runtime they are the same class.
  // Verify the shape at dev time to catch drift between the two type declarations.
  const contextValue = useMemo(() => {
    if (__DEV__) {
      if (typeof copilotkit.subscribe !== "function") {
        throw new Error(
          "[CopilotKit] CopilotKitCoreReact shape mismatch: headless bundle may have " +
            "diverged from the context type. Ensure @copilotkit/core versions are aligned.",
        );
      }
    }
    return {
      copilotkit,
      executingToolCallIds: EMPTY_SET,
    } as unknown as CopilotKitContextValue;
  }, [copilotkit]);

  return (
    <CopilotKitContext.Provider value={contextValue}>
      {children}
    </CopilotKitContext.Provider>
  );
};
