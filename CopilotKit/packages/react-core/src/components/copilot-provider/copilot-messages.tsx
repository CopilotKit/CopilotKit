/**
 * An internal context to separate the messages state (which is constantly changing) from the rest of CopilotKit context
 */

import {
  ReactNode,
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  createContext,
  useContext,
} from "react";
import { CopilotMessagesContext } from "../../context/copilot-messages-context";
import {
  loadMessagesFromJsonRepresentation,
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

// Helper to determine if error should show as banner based on visibility and legacy patterns
function shouldShowAsBanner(gqlError: GraphQLError): boolean {
  const extensions = gqlError.extensions;
  if (!extensions) return false;

  // Priority 1: Check error code for discovery errors (these should always be banners)
  const code = extensions.code as CopilotKitErrorCode;
  if (
    code === CopilotKitErrorCode.AGENT_NOT_FOUND ||
    code === CopilotKitErrorCode.API_NOT_FOUND ||
    code === CopilotKitErrorCode.REMOTE_ENDPOINT_NOT_FOUND ||
    code === CopilotKitErrorCode.CONFIGURATION_ERROR ||
    code === CopilotKitErrorCode.MISSING_PUBLIC_API_KEY_ERROR ||
    code === CopilotKitErrorCode.UPGRADE_REQUIRED_ERROR
  ) {
    return true;
  }

  // Priority 2: Check banner visibility
  if (extensions.visibility === ErrorVisibility.BANNER) {
    return true;
  }

  // Priority 3: Check for critical errors that should be banners regardless of formal classification
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

  // Priority 4: Legacy stack trace detection for discovery errors
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
  const lastLoadedThreadId = useRef<string>();
  const lastLoadedAgentName = useRef<string>();
  const lastLoadedMessages = useRef<string>();

  const { updateTapMessages } = useMessagesTap();

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

  useEffect(() => {
    updateTapMessages(messages);
  }, [messages, updateTapMessages]);

  const memoizedChildren = useMemo(() => children, [children]);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);

  return (
    <CopilotMessagesContext.Provider
      value={{
        messages,
        setMessages,
        suggestions,
        setSuggestions,
      }}
    >
      {memoizedChildren}
    </CopilotMessagesContext.Provider>
  );
}
