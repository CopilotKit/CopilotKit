import {
  CopilotRuntimeClient,
  CopilotRuntimeClientOptions,
  GraphQLError,
} from "@copilotkit/runtime-client-gql";
import { useToast } from "../components/toast/toast-provider";
import { useMemo, useRef } from "react";
import { useErrorToast } from "../components/error-boundary/error-utils";
import {
  ErrorVisibility,
  CopilotKitApiDiscoveryError,
  CopilotKitRemoteEndpointDiscoveryError,
  CopilotKitAgentDiscoveryError,
  CopilotKitError,
  CopilotKitErrorCode,
  ERROR_CONFIG,
} from "@copilotkit/shared";
import { shouldShowDevConsole } from "../utils/dev-console";

export interface CopilotRuntimeClientHookOptions extends CopilotRuntimeClientOptions {
  showDevConsole?: boolean;
}

export const useCopilotRuntimeClient = (options: CopilotRuntimeClientHookOptions) => {
  const { addGraphQLErrorsToast, setBannerError } = useToast();
  const addErrorToast = useErrorToast();
  const { addToast } = useToast();
  const { showDevConsole, ...runtimeOptions } = options;

  // Deduplication state for structured errors
  const lastStructuredErrorRef = useRef<{ message: string; timestamp: number } | null>(null);

  const runtimeClient = useMemo(() => {
    return new CopilotRuntimeClient({
      ...runtimeOptions,
      handleGQLErrors: (error) => {
        if ((error as any).graphQLErrors?.length) {
          const graphQLErrors = (error as any).graphQLErrors as GraphQLError[];

          // Route errors based on visibility level
          const routeError = (gqlError: GraphQLError) => {
            const extensions = gqlError.extensions;
            const visibility = extensions?.visibility as ErrorVisibility;
            const isDev = shouldShowDevConsole(showDevConsole ?? false);

            // If dev console is disabled, don't show ANY error UI to users
            if (!isDev) {
              console.error("CopilotKit Error (hidden in production):", gqlError.message);
              return null;
            }

            // Dev-only errors (explicit visibility takes priority)
            if (visibility === ErrorVisibility.DEV_ONLY) {
              // Deduplicate dev-only errors
              const now = Date.now();
              const errorMessage = gqlError.message;
              if (
                lastStructuredErrorRef.current &&
                lastStructuredErrorRef.current.message === errorMessage &&
                now - lastStructuredErrorRef.current.timestamp < 150
              ) {
                return null;
              }
              lastStructuredErrorRef.current = { message: errorMessage, timestamp: now };

              return gqlError;
            }

            // Silent errors - just log
            if (visibility === ErrorVisibility.SILENT) {
              console.error("CopilotKit Silent Error:", gqlError.message);
              return null;
            }

            // Handle banner errors via state management (only in dev mode)
            const shouldBeBanner = shouldShowAsBanner(gqlError);
            if (visibility === ErrorVisibility.BANNER || shouldBeBanner) {
              const ckError = createStructuredError(gqlError);
              if (ckError) {
                setBannerError(ckError);
                return null; // Don't show as toast
              }
            }

            // Default to toast for regular errors (only in dev mode) - deduplicate these
            if (visibility) {
              const now = Date.now();
              const errorMessage = gqlError.message;

              if (
                lastStructuredErrorRef.current &&
                lastStructuredErrorRef.current.message === errorMessage &&
                now - lastStructuredErrorRef.current.timestamp < 150
              ) {
                console.warn("Suppressing duplicate structured error:", errorMessage);
                return null;
              }

              // Record this error for deduplication
              lastStructuredErrorRef.current = { message: errorMessage, timestamp: now };
            }

            return gqlError;
          };

          const toastErrors = graphQLErrors.map(routeError).filter(Boolean) as GraphQLError[];

          if (toastErrors.length > 0) {
            addGraphQLErrorsToast(toastErrors);
          }
        } else {
          const isDev = shouldShowDevConsole(showDevConsole ?? false);
          if (!isDev) {
            console.error("CopilotKit Error (hidden in production):", error);
          } else {
            addErrorToast([error]);
          }
        }
      },
      handleGQLWarning: (message: string) => {
        console.warn(message);
        addToast({ type: "warning", message });
      },
    });
  }, [
    runtimeOptions,
    addGraphQLErrorsToast,
    addToast,
    addErrorToast,
    setBannerError,
    showDevConsole,
  ]);

  return runtimeClient;
};

// Helper to determine if error should show as banner based on structured error system
function shouldShowAsBanner(gqlError: GraphQLError): boolean {
  const extensions = gqlError.extensions;
  if (!extensions) return false;

  // Primary: Check error code and use structured config
  const code = extensions.code as CopilotKitErrorCode;
  if (code && ERROR_CONFIG[code]?.visibility === ErrorVisibility.BANNER) {
    return true;
  }

  // Fallback: Check for API key errors which should always be banners
  const errorMessage = gqlError.message.toLowerCase();
  if (
    errorMessage.includes("api key") ||
    errorMessage.includes("401") ||
    errorMessage.includes("unauthorized") ||
    errorMessage.includes("authentication") ||
    errorMessage.includes("incorrect api key")
  ) {
    return true;
  }

  // Legacy: Check by stack trace for discovery errors (for backward compatibility)
  const originalError = extensions.originalError as any;
  if (originalError?.stack) {
    return (
      originalError.stack.includes("CopilotApiDiscoveryError") ||
      originalError.stack.includes("CopilotKitRemoteEndpointDiscoveryError") ||
      originalError.stack.includes("CopilotKitAgentDiscoveryError")
    );
  }

  return false;
}

// Create appropriate structured error from GraphQL error
function createStructuredError(gqlError: GraphQLError): CopilotKitError | null {
  const extensions = gqlError.extensions;
  const originalError = extensions?.originalError as any;
  const message = originalError?.message || gqlError.message;
  const code = extensions?.code as CopilotKitErrorCode;

  if (code) {
    return new CopilotKitError({ message, code });
  }

  // Legacy error detection by stack trace
  if (originalError?.stack?.includes("CopilotApiDiscoveryError")) {
    return new CopilotKitApiDiscoveryError({ message });
  }
  if (originalError?.stack?.includes("CopilotKitRemoteEndpointDiscoveryError")) {
    return new CopilotKitRemoteEndpointDiscoveryError({ message });
  }
  if (originalError?.stack?.includes("CopilotKitAgentDiscoveryError")) {
    return new CopilotKitAgentDiscoveryError({
      agentName: "",
      availableAgents: [],
    });
  }

  return null;
}
