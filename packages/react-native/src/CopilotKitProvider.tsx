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
  EMPTY_SET,
} from "@copilotkit/react-core/v2/context";
import { CopilotKitCoreReact } from "@copilotkit/react-core/v2/headless";

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
  /** Error handler */
  onError?: (error: Error) => void;
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
  const [executingToolCallIds] = useState<ReadonlySet<string>>(EMPTY_SET);

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

  // Error handling
  useEffect(() => {
    if (!onError) return;
    const subscription = copilotkit.subscribe({
      onError: (event) => {
        onError(event.error);
      },
    });
    return () => subscription.unsubscribe();
  }, [copilotkit, onError]);

  // The headless bundle has its own type declaration for CopilotKitCoreReact
  // (due to inlining @copilotkit/core), but it's the same class at runtime.
  const contextValue = useMemo(
    () => ({
      copilotkit,
      executingToolCallIds,
    }),
    [copilotkit, executingToolCallIds],
  ) as unknown as CopilotKitContextValue;

  return (
    <CopilotKitContext.Provider value={contextValue}>
      {children}
    </CopilotKitContext.Provider>
  );
};
