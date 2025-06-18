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
        console.log("🐛 handleGQLErrors: Processing error", error);
        if ((error as any).graphQLErrors?.length) {
          const graphQLErrors = (error as any).graphQLErrors as GraphQLError[];
          console.log("🐛 handleGQLErrors: GraphQL errors count", graphQLErrors.length);

          // Route errors based on visibility level
          const routeError = (gqlError: GraphQLError) => {
            console.log("🐛 routeError: Processing GraphQL error", gqlError.message);
            console.log("🐛 routeError: Extensions", gqlError.extensions);
            const extensions = gqlError.extensions;
            const visibility = extensions?.visibility as ErrorVisibility;
            const isDev = shouldShowDevConsole("auto");
            console.log("🐛 routeError: visibility =", visibility, "isDev =", isDev);
            console.log("🐛 routeError: ErrorVisibility.DEV_ONLY =", ErrorVisibility.DEV_ONLY);
            console.log(
              "🐛 routeError: visibility === ErrorVisibility.DEV_ONLY =",
              visibility === ErrorVisibility.DEV_ONLY,
            );

            // Dev-only errors (explicit visibility takes priority)
            console.log("🐛 routeError: Checking dev-only condition first...");
            if (visibility === ErrorVisibility.DEV_ONLY) {
              console.log("🐛 routeError: *** INSIDE DEV_ONLY BLOCK ***");
              console.log(
                "🐛 Dev-only error detected:",
                gqlError.message,
                "isDev:",
                isDev,
                "visibility:",
                visibility,
              );
              console.log("🐛 Dev-only: Checking isDev condition, isDev =", isDev);
              if (!isDev) {
                console.log("🐛 Dev-only: isDev is false, hiding error");
                console.warn("CopilotKit Development Error:", gqlError.message);
                return null;
              }

              // Deduplicate dev-only errors
              const now = Date.now();
              const errorMessage = gqlError.message;
              if (
                lastStructuredErrorRef.current &&
                lastStructuredErrorRef.current.message === errorMessage &&
                now - lastStructuredErrorRef.current.timestamp < 150
              ) {
                console.log("🐛 Dev-only: Suppressing duplicate dev-only error:", errorMessage);
                return null;
              }
              lastStructuredErrorRef.current = { message: errorMessage, timestamp: now };

              console.log("🐛 Dev-only: isDev is true, showing as toast");
              // In dev mode, show dev-only errors as toasts
              console.log("🐛 Showing dev-only error as toast, returning error:", gqlError);
              return gqlError;
            }

            // Silent errors - just log
            if (visibility === ErrorVisibility.SILENT) {
              console.error("CopilotKit Silent Error:", gqlError.message);
              return null;
            }

            // Handle banner errors via state management (after explicit visibility checks)
            console.log("🐛 routeError: Checking banner condition...");
            if (visibility === ErrorVisibility.BANNER || shouldShowAsBanner(gqlError)) {
              console.log("🐛 routeError: BANNER ERROR DETECTED - returning null");
              const ckError = createStructuredError(gqlError);
              if (ckError) {
                setBannerError(ckError);
                return null; // Don't show as toast
              }
            }
            console.log("🐛 routeError: Not a banner error, continuing...");

            // Default to toast for regular errors - deduplicate these
            if (visibility) {
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

            return gqlError;
          };

          const toastErrors = graphQLErrors.map(routeError).filter(Boolean) as GraphQLError[];
          console.log("🐛 handleGQLErrors: Toast errors count", toastErrors.length);

          if (toastErrors.length > 0) {
            console.log("🐛 handleGQLErrors: Calling addGraphQLErrorsToast with", toastErrors);
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
