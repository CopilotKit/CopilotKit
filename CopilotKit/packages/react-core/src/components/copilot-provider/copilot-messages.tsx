/**
 * An internal context to separate the messages state (which is constantly changing) from the rest of CopilotKit context
 */

import { ReactNode, useEffect, useState, useRef, useCallback, useMemo } from "react";
import { CopilotMessagesContext } from "../../context/copilot-messages-context";
import {
  loadMessagesFromJsonRepresentation,
  Message,
  GraphQLError,
} from "@copilotkit/runtime-client-gql";
import { useCopilotContext } from "../../context/copilot-context";
import { useToast } from "../toast/toast-provider";
import { shouldShowDevConsole } from "../../utils/dev-console";
import { isAbortError } from "@copilotkit/shared";
import {
  ErrorVisibility,
  CopilotKitApiDiscoveryError,
  CopilotKitRemoteEndpointDiscoveryError,
  CopilotKitAgentDiscoveryError,
  CopilotKitError,
  CopilotKitErrorCode,
} from "@copilotkit/shared";
import { traceUIError, createStructuredError } from "../error-boundary/error-utils";

// Helper to determine if error should show as banner based on visibility and legacy patterns
function shouldShowAsBanner(gqlError: GraphQLError): boolean {
  const extensions = gqlError.extensions;
  if (!extensions) return false;

  // Priority 1: Check error code for discovery errors (these should always be banners)
  if (extensions.code === CopilotKitErrorCode.API_NOT_FOUND) return true;
  if (extensions.code === CopilotKitErrorCode.REMOTE_ENDPOINT_NOT_FOUND) return true;
  if (extensions.code === CopilotKitErrorCode.AGENT_NOT_FOUND) return true;

  // Priority 2: Check legacy stack trace patterns
  const originalError = extensions.originalError as any;
  if (originalError?.stack) {
    if (originalError.stack.includes("CopilotApiDiscoveryError")) return true;
    if (originalError.stack.includes("CopilotKitRemoteEndpointDiscoveryError")) return true;
    if (originalError.stack.includes("CopilotKitAgentDiscoveryError")) return true;
  }

  // Priority 3: Check API key errors
  if (extensions.code === CopilotKitErrorCode.MISSING_PUBLIC_API_KEY_ERROR) return true;
  if (extensions.code === CopilotKitErrorCode.UPGRADE_REQUIRED_ERROR) return true;

  return false;
}

export function CopilotMessages({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const lastLoadedThreadId = useRef<string>();
  const lastLoadedAgentName = useRef<string>();
  const lastLoadedMessages = useRef<string>();

  const { threadId, agentSession, runtimeClient, showDevConsole, onError, copilotApiConfig } =
    useCopilotContext();
  const { setBannerError } = useToast();

  const handleGraphQLErrors = useCallback(
    (error: any) => {
      if (error.graphQLErrors?.length) {
        const graphQLErrors = error.graphQLErrors as GraphQLError[];

        // Route all errors to banners for consistent UI
        const routeError = (gqlError: GraphQLError) => {
          const extensions = gqlError.extensions;
          const visibility = extensions?.visibility as ErrorVisibility;
          const isDev = shouldShowDevConsole(showDevConsole);

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
            // Trace the structured error using shared utility
            traceUIError(
              ckError,
              gqlError,
              onError,
              copilotApiConfig.publicApiKey,
              "loadAgentState",
              copilotApiConfig.chatApiEndpoint,
            );
            return;
          }

          // For non-structured errors, only show in development
          if (!isDev) {
            console.error("CopilotKit Error (hidden in production):", gqlError.message);
            return;
          }

          // Development-only: Show unstructured errors as banners
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
            copilotApiConfig.publicApiKey,
            "loadAgentState",
            copilotApiConfig.chatApiEndpoint,
          );
        };

        // Process all errors as banners
        graphQLErrors.forEach(routeError);
      } else {
        const isDev = shouldShowDevConsole(showDevConsole);

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
            copilotApiConfig.publicApiKey,
            "loadAgentState",
            copilotApiConfig.chatApiEndpoint,
          );
        }
      }
    },
    [
      setBannerError,
      showDevConsole,
      onError,
      copilotApiConfig.publicApiKey,
      copilotApiConfig.chatApiEndpoint,
    ],
  );

  useEffect(() => {
    if (!threadId || threadId === lastLoadedThreadId.current) return;
    if (
      threadId === lastLoadedThreadId.current &&
      agentSession?.agentName === lastLoadedAgentName.current
    ) {
      return;
    }

    const fetchMessages = async () => {
      if (!agentSession?.agentName) return;

      const result = await runtimeClient.loadAgentState({
        threadId,
        agentName: agentSession?.agentName,
      });

      // Check for GraphQL errors and manually trigger error handling
      if (result.error) {
        // Update refs to prevent infinite retries of the same failed request
        lastLoadedThreadId.current = threadId;
        lastLoadedAgentName.current = agentSession?.agentName;
        handleGraphQLErrors(result.error);
        return; // Don't try to process the data if there's an error
      }

      const newMessages = result.data?.loadAgentState?.messages;
      if (newMessages === lastLoadedMessages.current) return;

      if (result.data?.loadAgentState?.threadExists) {
        lastLoadedMessages.current = newMessages;
        lastLoadedThreadId.current = threadId;
        lastLoadedAgentName.current = agentSession?.agentName;

        const messages = loadMessagesFromJsonRepresentation(JSON.parse(newMessages || "[]"));
        setMessages(messages);
      }
    };
    void fetchMessages();
  }, [threadId, agentSession?.agentName]);

  const memoizedChildren = useMemo(() => children, [children]);

  return (
    <CopilotMessagesContext.Provider
      value={{
        messages,
        setMessages,
      }}
    >
      {memoizedChildren}
    </CopilotMessagesContext.Provider>
  );
}
