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

export const useCopilotRuntimeClient = (options: CopilotRuntimeClientOptions) => {
  const { addGraphQLErrorsToast, setBannerError } = useToast();
  const addErrorToast = useErrorToast();
  const { addToast } = useToast();

  // Deduplication state for structured errors
  const lastStructuredErrorRef = useRef<{ message: string; timestamp: number } | null>(null);

  const runtimeClient = useMemo(() => {
    return new CopilotRuntimeClient({
      ...options,
      handleGQLErrors: (error) => {
        if ((error as any).graphQLErrors?.length) {
          const graphQLErrors = (error as any).graphQLErrors as GraphQLError[];

          // Route errors based on visibility level
          const routeError = (gqlError: GraphQLError) => {
            const extensions = gqlError.extensions;
            const visibility = extensions?.visibility as ErrorVisibility;
            const isDev = process.env.NODE_ENV === "development";

            // Deduplicate structured errors
            if (visibility && visibility !== ErrorVisibility.SILENT) {
              const now = Date.now();
              const errorMessage = gqlError.message;

              if (
                lastStructuredErrorRef.current &&
                lastStructuredErrorRef.current.message === errorMessage &&
                now - lastStructuredErrorRef.current.timestamp < 150
              ) {
                // This is a duplicate error within 150ms, skip it
                console.warn("Suppressing duplicate structured error:", errorMessage);
                return null;
              }

              // Record this error for deduplication
              lastStructuredErrorRef.current = { message: errorMessage, timestamp: now };
            }

            // Handle banner errors via state management instead of throwing
            if (visibility === ErrorVisibility.BANNER || shouldShowAsBanner(gqlError)) {
              const ckError = createStructuredError(gqlError);
              if (ckError) {
                setBannerError(ckError);
                return null; // Don't show as toast
              }
            }

            // Dev-only errors
            if (visibility === ErrorVisibility.DEV_ONLY && !isDev) {
              console.warn("CopilotKit Development Error:", gqlError.message);
              return null;
            }

            // Silent errors - just log
            if (visibility === ErrorVisibility.SILENT) {
              console.error("CopilotKit Silent Error:", gqlError.message);
              return null;
            }

            // Default to toast for regular errors
            return gqlError;
          };

          const toastErrors = graphQLErrors.map(routeError).filter(Boolean) as GraphQLError[];

          if (toastErrors.length > 0) {
            addGraphQLErrorsToast(toastErrors);
          }
        } else {
          addErrorToast([error]);
        }
      },
      handleGQLWarning: (message: string) => {
        console.warn(message);
        addToast({ type: "warning", message });
      },
    });
  }, [options, addGraphQLErrorsToast, addToast, addErrorToast, setBannerError]);

  return runtimeClient;
};

// Helper to determine if error should show as banner based on legacy patterns
function shouldShowAsBanner(gqlError: GraphQLError): boolean {
  const extensions = gqlError.extensions;
  if (!extensions) return false;

  // Check error code
  const code = extensions.code as CopilotKitErrorCode;
  if (code && ERROR_CONFIG[code]?.visibility === ErrorVisibility.BANNER) {
    return true;
  }

  // Check by stack trace for discovery errors (legacy detection)
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
