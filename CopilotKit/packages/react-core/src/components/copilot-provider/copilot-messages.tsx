/**
 * An internal context to separate the messages state (which is constantly changing) from the rest of CopilotKit context
 */

import {
  ReactNode,
  useEffect,
  useState,
  useRef,
  useCallback,
  createContext,
  useContext,
} from "react";
import { CopilotMessagesContext } from "../../context/copilot-messages-context";
import {
  Message,
  GraphQLError,
} from "@copilotkit/runtime-client-gql";
import { useCopilotContext } from "../../context/copilot-context";
import { useToast } from "../toast/toast-provider";
import { shouldShowDevConsole } from "../../utils/dev-console";
import {
  ErrorVisibility,
  CopilotKitApiDiscoveryError,
  CopilotKitRemoteEndpointDiscoveryError,
  CopilotKitAgentDiscoveryError,
  CopilotKitError,
  CopilotKitErrorCode,
} from "@copilotkit/shared";
import { SuggestionItem } from "../../utils/suggestions";
import { useAgentStateQuery } from "../../queries/agent-state";

/**
 * MessagesTap is used to mitigate performance issues when we only need
 * a snapshot of the messages, not a continuously updating stream of messages.
 */

export type MessagesTap = {
  getMessagesFromTap: () => Message[];
  updateTapMessages: (messages: Message[]) => void;
};

const MessagesTapContext = createContext<MessagesTap | null>(null);

export function useMessagesTap() {
  const tap = useContext(MessagesTapContext);
  if (!tap) throw new Error("useMessagesTap must be used inside <MessagesTapProvider>");
  return tap;
}

export function MessagesTapProvider({ children }: { children: React.ReactNode }) {
  const messagesRef = useRef<Message[]>([]);

  const tapRef = useRef<MessagesTap>({
    getMessagesFromTap: () => messagesRef.current,
    updateTapMessages: (messages: Message[]) => {
      messagesRef.current = messages;
    },
  });

  return (
    <MessagesTapContext.Provider value={tapRef.current}>{children}</MessagesTapContext.Provider>
  );
}

/**
 * CopilotKit messages context.
 */

export function CopilotMessages({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const { updateTapMessages } = useMessagesTap();
  const lastHandledErrorRef = useRef<any>(null);

  const { threadId, agentSession, runtimeClient, showDevConsole, onError, copilotApiConfig } =
    useCopilotContext();
  const { setBannerError } = useToast();

  // Helper function to trace UI errors (similar to useCopilotRuntimeClient)
  const traceUIError = useCallback(
    async (error: CopilotKitError, originalError?: any) => {
      // Just check if onError and publicApiKey are defined
      if (!onError || !copilotApiConfig.publicApiKey) return;

      try {
        const traceEvent = {
          type: "error" as const,
          timestamp: Date.now(),
          context: {
            source: "ui" as const,
            request: {
              operation: "loadAgentState",
              url: copilotApiConfig.chatApiEndpoint,
              startTime: Date.now(),
            },
            technical: {
              environment: "browser",
              userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
              stackTrace: originalError instanceof Error ? originalError.stack : undefined,
            },
          },
          error,
        };
        await onError(traceEvent);
      } catch (traceError) {
        console.error("Error in CopilotMessages onError handler:", traceError);
      }
    },
    [onError, copilotApiConfig.publicApiKey, copilotApiConfig.chatApiEndpoint],
  );

  const createStructuredError = (gqlError: GraphQLError): CopilotKitError | null => {
    const extensions = gqlError.extensions;
    const originalError = extensions?.originalError as any;

    // Priority: Check stack trace for discovery errors first
    if (originalError?.stack) {
      if (originalError.stack.includes("CopilotApiDiscoveryError")) {
        return new CopilotKitApiDiscoveryError({ message: originalError.message });
      }
      if (originalError.stack.includes("CopilotKitRemoteEndpointDiscoveryError")) {
        return new CopilotKitRemoteEndpointDiscoveryError({ message: originalError.message });
      }
      if (originalError.stack.includes("CopilotKitAgentDiscoveryError")) {
        return new CopilotKitAgentDiscoveryError({
          agentName: "",
          availableAgents: [],
        });
      }
    }

    // Fallback: Use the formal error code if available
    const message = originalError?.message || gqlError.message;
    const code = extensions?.code as CopilotKitErrorCode;

    if (code) {
      return new CopilotKitError({ message, code });
    }

    return null;
  };

  const handleGraphQLErrors = useCallback(
    (error: any) => {
      if (error.graphQLErrors?.length) {
        const graphQLErrors = error.graphQLErrors as GraphQLError[];

        // Route all errors to banners for consistent UI
        const routeError = (gqlError: GraphQLError) => {
          const extensions = gqlError.extensions;
          const visibility = extensions?.visibility as ErrorVisibility;
          const isDev = shouldShowDevConsole(showDevConsole);

          if (!isDev) {
            console.error("CopilotKit Error (hidden in production):", gqlError.message);
            return;
          }

          // Silent errors - just log
          if (visibility === ErrorVisibility.SILENT) {
            console.error("CopilotKit Silent Error:", gqlError.message);
            return;
          }

          // All other errors (including DEV_ONLY) show as banners for consistency
          const ckError = createStructuredError(gqlError);
          if (ckError) {
            setBannerError(ckError);
            // Trace the structured error
            traceUIError(ckError, gqlError);
          } else {
            // Fallback: create a generic error for unstructured GraphQL errors
            const fallbackError = new CopilotKitError({
              message: gqlError.message,
              code: CopilotKitErrorCode.UNKNOWN,
            });
            setBannerError(fallbackError);
            // Trace the fallback error
            traceUIError(fallbackError, gqlError);
          }
        };

        // Process all errors as banners
        graphQLErrors.forEach(routeError);
      } else {
        const isDev = shouldShowDevConsole(showDevConsole);
        if (!isDev) {
          console.error("CopilotKit Error (hidden in production):", error);
        } else {
          // Route non-GraphQL errors to banner as well
          const fallbackError = new CopilotKitError({
            message: error?.message || String(error),
            code: CopilotKitErrorCode.UNKNOWN,
          });
          setBannerError(fallbackError);
          // Trace the non-GraphQL error
          traceUIError(fallbackError, error);
        }
      }
    },
    [setBannerError, showDevConsole, traceUIError],
  );

  const agentName = agentSession?.agentName;

   // Centralized agent state query
  const { data: fetchedMessages, error: queryError, isSuccess } = useAgentStateQuery({
    threadId,
    agentName,
    runtimeClient,
  });

  // Handle errors outside the query execution cycle
  useEffect(() => {
    if (queryError && queryError !== lastHandledErrorRef.current) {
      lastHandledErrorRef.current = queryError;
      handleGraphQLErrors(queryError);
    }
  }, [queryError, handleGraphQLErrors]);

  // Sync to local state (for compatibility with existing consumers)
  useEffect(() => {
    if (!isSuccess) return;
    setMessages(fetchedMessages);
  }, [isSuccess, fetchedMessages]);

  // Keep tap messages in sync
  useEffect(() => {
    updateTapMessages(messages);
  }, [messages, updateTapMessages]);

  const [suggestions, setSuggestionsState] = useState<SuggestionItem[]>([]);

  // Wrap setSuggestions in useCallback to prevent infinite re-renders in consumers
  const setSuggestions = useCallback((newSuggestions: SuggestionItem[] | ((prev: SuggestionItem[]) => SuggestionItem[])) => {
    setSuggestionsState(newSuggestions);
  }, []);

  return (
    <CopilotMessagesContext.Provider
      value={{
        messages,
        setMessages,
        suggestions,
        setSuggestions,
      }}
    >
      {children}
    </CopilotMessagesContext.Provider>
  );
}
