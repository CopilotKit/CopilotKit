import {
  CopilotRuntimeClient,
  CopilotRuntimeClientOptions,
  GraphQLError,
} from "@copilotkit/runtime-client-gql";
import { useToast } from "../components/toast/toast-provider";
import { useMemo, useRef } from "react";
import {
  ErrorVisibility,
  CopilotKitApiDiscoveryError,
  CopilotKitRemoteEndpointDiscoveryError,
  CopilotKitAgentDiscoveryError,
  CopilotKitError,
  CopilotKitErrorCode,
  CopilotErrorHandler,
  CopilotErrorEvent,
} from "@copilotkit/shared";
import { shouldShowDevConsole } from "../utils/dev-console";
import { isAbortError } from "@copilotkit/shared";
import { traceUIError, createStructuredError } from "../components/error-boundary/error-utils";

export interface CopilotRuntimeClientHookOptions extends CopilotRuntimeClientOptions {
  showDevConsole?: boolean;
  onError?: CopilotErrorHandler;
}

export const useCopilotRuntimeClient = (options: CopilotRuntimeClientHookOptions) => {
  const { setBannerError } = useToast();
  const { showDevConsole, onError, ...runtimeOptions } = options;

  // Deduplication state for structured errors
  const lastStructuredErrorRef = useRef<{ message: string; timestamp: number } | null>(null);

  const runtimeClient = useMemo(() => {
    return new CopilotRuntimeClient({
      ...runtimeOptions,
      handleGQLErrors: (error) => {
        if ((error as any).graphQLErrors?.length) {
          const graphQLErrors = (error as any).graphQLErrors as GraphQLError[];

          // Route all errors to banners for consistent UI
          const routeError = (gqlError: GraphQLError) => {
            const extensions = gqlError.extensions;
            const visibility = extensions?.visibility as ErrorVisibility;
            const isDev = shouldShowDevConsole(showDevConsole ?? false);

            // Suppress abort errors from debounced autosuggestion requests
            if (isAbortError(gqlError)) {
              return;
            }

            // Silent errors - just log
            if (visibility === ErrorVisibility.SILENT) {
              console.error("CopilotKit Silent Error:", gqlError.message);
              return;
            }

            // Always show structured errors as banners regardless of dev mode
            const ckError = createStructuredError(gqlError);
            if (ckError) {
              setBannerError(ckError);
              // Trace the error using shared utility
              traceUIError(
                ckError,
                gqlError,
                onError,
                runtimeOptions.publicApiKey,
                "runtimeClient",
                runtimeOptions.url,
              );
              return;
            }

            // For non-structured errors, only show in development
            if (!isDev) {
              console.error("CopilotKit Error (hidden in production):", gqlError.message);
              return;
            }

            // Development-only: Show unstructured errors as banners with deduplication
            const now = Date.now();
            const errorMessage = gqlError.message;
            if (
              lastStructuredErrorRef.current &&
              lastStructuredErrorRef.current.message === errorMessage &&
              now - lastStructuredErrorRef.current.timestamp < 150
            ) {
              return; // Skip duplicate
            }
            lastStructuredErrorRef.current = { message: errorMessage, timestamp: now };

            // Fallback for unstructured errors in development
            const fallbackError = new CopilotKitError({
              message: gqlError.message,
              code: CopilotKitErrorCode.UNKNOWN,
            });
            setBannerError(fallbackError);
            // Trace the fallback error using shared utility
            traceUIError(
              fallbackError,
              gqlError,
              onError,
              runtimeOptions.publicApiKey,
              "runtimeClient",
              runtimeOptions.url,
            );
          };

          // Process all errors as banners
          graphQLErrors.forEach(routeError);
        } else {
          const isDev = shouldShowDevConsole(showDevConsole ?? false);

          // Suppress abort errors from debounced autosuggestion requests
          if (isAbortError(error)) {
            return;
          }

          if (!isDev) {
            console.error("CopilotKit Error (hidden in production):", error);
          } else {
            // Route non-GraphQL errors to banner as well
            const fallbackError = new CopilotKitError({
              message: error?.message || String(error),
              code: CopilotKitErrorCode.UNKNOWN,
            });
            setBannerError(fallbackError);
            // Trace the non-GraphQL error using shared utility
            traceUIError(
              fallbackError,
              error,
              onError,
              runtimeOptions.publicApiKey,
              "runtimeClient",
              runtimeOptions.url,
            );
          }
        }
      },
      handleGQLWarning: (message: string) => {
        console.warn(message);
        // Show warnings as banners too for consistency
        const warningError = new CopilotKitError({
          message,
          code: CopilotKitErrorCode.UNKNOWN,
        });
        setBannerError(warningError);
      },
    });
  }, [runtimeOptions, setBannerError, showDevConsole, onError]);

  return runtimeClient;
};
