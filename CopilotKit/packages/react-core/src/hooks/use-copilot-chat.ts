/**
 * `useCopilotChat` is a React hook that lets you directly interact with the
 * Copilot instance. Use to implement a fully custom UI (headless UI) or to
 * programmatically interact with the Copilot instance managed by the default
 * UI.
 *
 * ## Usage
 *
 * ### Simple Usage
 *
 * ```tsx
 * import { useCopilotChat } from "@copilotkit/react-core";
 * import { Role, TextMessage } from "@copilotkit/runtime-client-gql";
 *
 * export function YourComponent() {
 *   const { appendMessage } = useCopilotChat();
 *
 *   appendMessage(
 *     new TextMessage({
 *       content: "Hello World",
 *       role: Role.User,
 *     }),
 *   );
 *
 *   // optionally, you can append a message without running chat completion
 *   appendMessage(yourMessage, { followUp: false });
 * }
 * ```
 *
 * `useCopilotChat` returns an object with the following properties:
 *
 * ```tsx
 * const {
 *   visibleMessages, // An array of messages that are currently visible in the chat.
 *   appendMessage, // A function to append a message to the chat.
 *   setMessages, // A function to set the messages in the chat.
 *   deleteMessage, // A function to delete a message from the chat.
 *   reloadMessages, // A function to reload the messages from the API.
 *   stopGeneration, // A function to stop the generation of the next message.
 *   reset, // A function to reset the chat.
 *   isLoading, // A boolean indicating if the chat is loading.
 * } = useCopilotChat();
 * ```
 */
import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { AgentSession, useCopilotContext, CopilotContextParams } from "../context/copilot-context";
import { useCopilotMessagesContext, CopilotMessagesContextParams } from "../context";
import { SystemMessageFunction } from "../types";
import { useChat, AppendMessageOptions } from "./use-chat";
import { defaultCopilotContextCategories } from "../components";
import { CoAgentStateRenderHandlerArguments } from "@copilotkit/shared";
import { useAsyncCallback } from "../components/error-boundary/error-utils";
import { reloadSuggestions } from "../utils";
import type { SuggestionItem } from "../utils";
import { LangGraphInterruptAction } from "../types/interrupt-action";

import { Message } from "@copilotkit/shared";
import {
  Role as gqlRole, 
  TextMessage,
  aguiToGQL,
  gqlToAGUI,
} from "@copilotkit/runtime-client-gql";
import { useLangGraphInterruptRender } from "./use-langgraph-interrupt-render";

export interface UseCopilotChatOptions {
  /**
   * A unique identifier for the chat. If not provided, a random one will be
   * generated. When provided, the `useChat` hook with the same `id` will
   * have shared states across components.
   */
  id?: string;

  /**
   * HTTP headers to be sent with the API request.
   */
  headers?: Record<string, string> | Headers;
  /**
   * System messages of the chat. Defaults to an empty array.
   */
  initialMessages?: Message[];

  /**
   * A function to generate the system message. Defaults to `defaultSystemMessage`.
   */
  makeSystemMessage?: SystemMessageFunction;
}

export interface MCPServerConfig {
  endpoint: string;
  apiKey?: string;
}

export interface UseCopilotChatReturn {
  visibleMessages: (Message)[];
  appendMessage: (message: Message, options?: AppendMessageOptions) => Promise<void>;
  setMessages: (messages: Message[]) => void;
  deleteMessage: (messageId: string) => void;
  reloadMessages: (messageId: string) => Promise<void>;
  stopGeneration: () => void;
  reset: () => void;
  isLoading: boolean;
  runChatCompletion: () => Promise<Message[]>;
  mcpServers: MCPServerConfig[];
  setMcpServers: (mcpServers: MCPServerConfig[]) => void;
  suggestions: SuggestionItem[];
  setSuggestions: (suggestions: SuggestionItem[]) => void;
  reloadSuggestions: () => Promise<void>;
  interrupt: string | React.ReactElement | null;
}

const SUGGESTIONS_DEBOUNCE_TIMEOUT = 1000;

export function useCopilotChat({
  makeSystemMessage,
  ...options
}: UseCopilotChatOptions = {}): UseCopilotChatReturn {
  const {
    getContextString,
    getFunctionCallHandler,
    copilotApiConfig,
    isLoading,
    setIsLoading,
    chatInstructions,
    actions,
    coagentStatesRef,
    setCoagentStatesWithRef,
    coAgentStateRenders,
    agentSession,
    setAgentSession,
    forwardedParameters,
    agentLock,
    threadId,
    setThreadId,
    runId,
    setRunId,
    chatAbortControllerRef,
    extensions,
    setExtensions,
    langGraphInterruptAction,
    setLangGraphInterruptAction,
    chatSuggestionConfiguration,
    suggestions,
    setSuggestions,
  } = useCopilotContext();
  const { messages, setMessages } = useCopilotMessagesContext();

  // Simple state for MCP servers (keep for interface compatibility)
  const [mcpServers, setLocalMcpServers] = useState<MCPServerConfig[]>([]);

  // Add suggestion state - same as useCopilotChatLogic
  const suggestionsAbortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<any>();
  const isLoadingSuggestionsRef = useRef<boolean>(false);

  const abortSuggestions = () => {
    suggestionsAbortControllerRef.current?.abort();
    suggestionsAbortControllerRef.current = null;
    isLoadingSuggestionsRef.current = false;
  };

  // Create combined context for suggestions - memoize to prevent infinite loops
  const generalContext = useCopilotContext();
  const messagesContext = useCopilotMessagesContext();
  
  // Only include the specific properties needed for suggestions to avoid infinite re-renders
  const context = useMemo(() => ({
    actions: generalContext.actions,
    copilotApiConfig: generalContext.copilotApiConfig,
    chatSuggestionConfiguration: generalContext.chatSuggestionConfiguration,
    messages: messagesContext.messages,
    setMessages: messagesContext.setMessages,
    getContextString: generalContext.getContextString,
    runtimeClient: generalContext.runtimeClient,
  }), [
    generalContext.actions,
    generalContext.chatSuggestionConfiguration,
    messagesContext.messages,
    generalContext.runtimeClient,
  ]);

  // Use the shared reloadSuggestions function
  const reloadSuggestionsFunc = useCallback(async () => {
    if (isLoadingSuggestionsRef.current) {
      return;
    }

    try {
      isLoadingSuggestionsRef.current = true;
      await reloadSuggestions(
        context as CopilotContextParams & CopilotMessagesContextParams,
        chatSuggestionConfiguration,
        setSuggestions,
        suggestionsAbortControllerRef,
      );
    } catch (error) {
      console.error("Error in reloadSuggestions:", error);
      // Don't rethrow to prevent infinite retries
    } finally {
      isLoadingSuggestionsRef.current = false;
    }
  }, [context, chatSuggestionConfiguration]);

  // This effect directly updates the context when mcpServers state changes
  useEffect(() => {
    if (mcpServers.length > 0) {
      // Copy to avoid issues
      const serversCopy = [...mcpServers];

      // Update in all locations
      copilotApiConfig.mcpServers = serversCopy;

      // Also ensure it's in properties
      if (!copilotApiConfig.properties) {
        copilotApiConfig.properties = {};
      }
      copilotApiConfig.properties.mcpServers = serversCopy;
    }
  }, [mcpServers, copilotApiConfig]);

  // Provide the same interface
  const setMcpServers = useCallback((servers: MCPServerConfig[]) => {
    setLocalMcpServers(servers);
  }, []);

  // Move these function declarations above the useChat call
  const onCoAgentStateRender = useAsyncCallback(
    async (args: CoAgentStateRenderHandlerArguments) => {
      const { name, nodeName, state } = args;
      let action = Object.values(coAgentStateRenders).find(
        (action) => action.name === name && action.nodeName === nodeName,
      );
      if (!action) {
        action = Object.values(coAgentStateRenders).find(
          (action) => action.name === name && !action.nodeName,
        );
      }
      if (action) {
        await action.handler?.({ state, nodeName });
      }
    },
    [coAgentStateRenders],
  );

  const makeSystemMessageCallback = useCallback(() => {
    const systemMessageMaker = makeSystemMessage || defaultSystemMessage;
    // this always gets the latest context string
    const contextString = getContextString([], defaultCopilotContextCategories); // TODO: make the context categories configurable

    return new TextMessage({
      content: systemMessageMaker(contextString, chatInstructions),
      role: gqlRole.System,
    });
  }, [getContextString, makeSystemMessage, chatInstructions]);

  const deleteMessage = useCallback(
    (messageId: string) => {
      setMessages((prev) => prev.filter((message) => message.id !== messageId));
    },
    [setMessages],
  );

  // Get chat helpers with updated config
  const { append, reload, stop, runChatCompletion } = useChat({
    ...options,
    actions: Object.values(actions),
    copilotConfig: copilotApiConfig,
    initialMessages: aguiToGQL(options.initialMessages || []),
    onFunctionCall: getFunctionCallHandler(),
    onCoAgentStateRender,
    messages,
    setMessages,
    makeSystemMessageCallback,
    isLoading,
    setIsLoading,
    coagentStatesRef,
    setCoagentStatesWithRef,
    agentSession,
    setAgentSession,
    forwardedParameters,
    threadId,
    setThreadId,
    runId,
    setRunId,
    chatAbortControllerRef,
    agentLock,
    extensions,
    setExtensions,
    langGraphInterruptAction,
    setLangGraphInterruptAction,
  });

  const latestAppend = useUpdatedRef(append);
  const latestAppendFunc = useAsyncCallback(
    async (message: Message, options?: AppendMessageOptions) => {
      return await latestAppend.current(aguiToGQL([message])[0], options);
    },
    [latestAppend],
  );

  const latestReload = useUpdatedRef(reload);
  const latestReloadFunc = useAsyncCallback(
    async (messageId: string) => {
      return await latestReload.current(messageId);
    },
    [latestReload],
  );

  const latestStop = useUpdatedRef(stop);
  const latestStopFunc = useCallback(() => {
    return latestStop.current();
  }, [latestStop]);

  const latestDelete = useUpdatedRef(deleteMessage);
  const latestDeleteFunc = useCallback(
    (messageId: string) => {
      return latestDelete.current(messageId);
    },
    [latestDelete],
  );

  const latestSetMessages = useUpdatedRef(setMessages);
  const latestSetMessagesFunc = useCallback(
    (messages: Message[]) => {
      return latestSetMessages.current(aguiToGQL(messages));
    },
    [latestSetMessages],
  );

  const latestRunChatCompletion = useUpdatedRef(runChatCompletion);
  const latestRunChatCompletionFunc = useAsyncCallback(async () => {
    return await latestRunChatCompletion.current!();
  }, [latestRunChatCompletion]);

  const reset = useCallback(() => {
    latestStopFunc();
    setMessages([]);
    setRunId(null);
    setCoagentStatesWithRef({});
    let initialAgentSession: AgentSession | null = null;
    if (agentLock) {
      initialAgentSession = {
        agentName: agentLock,
      };
    }
    setAgentSession(initialAgentSession);
  }, [
    latestStopFunc,
    setMessages,
    setThreadId,
    setCoagentStatesWithRef,
    setAgentSession,
    agentLock,
  ]);

  const latestReset = useUpdatedRef(reset);
  const latestResetFunc = useCallback(() => {
    return latestReset.current();
  }, [latestReset]);

  const interrupt = useLangGraphInterruptRender();

  return {
    visibleMessages: gqlToAGUI(messages, actions, coAgentStateRenders),
    appendMessage: latestAppendFunc,
    setMessages: latestSetMessagesFunc,
    reloadMessages: latestReloadFunc,
    stopGeneration: latestStopFunc,
    reset: latestResetFunc,
    deleteMessage: latestDeleteFunc,
    runChatCompletion: latestRunChatCompletionFunc,
    isLoading,
    mcpServers,
    setMcpServers,
    suggestions,
    setSuggestions,
    reloadSuggestions: reloadSuggestionsFunc,
    interrupt,
  };
}

// store `value` in a ref and update
// it whenever it changes.
function useUpdatedRef<T>(value: T) {
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}

export function defaultSystemMessage(
  contextString: string,
  additionalInstructions?: string,
): string {
  return (
    `
Please act as an efficient, competent, conscientious, and industrious professional assistant.

Help the user achieve their goals, and you do so in a way that is as efficient as possible, without unnecessary fluff, but also without sacrificing professionalism.
Always be polite and respectful, and prefer brevity over verbosity.

The user has provided you with the following context:
\`\`\`
${contextString}
\`\`\`

They have also provided you with functions you can call to initiate actions on their behalf, or functions you can call to receive more information.

Please assist them as best you can.

You can ask them for clarifying questions if needed, but don't be annoying about it. If you can reasonably 'fill in the blanks' yourself, do so.

If you would like to call a function, call it without saying anything else.
In case of a function error:
- If this error stems from incorrect function parameters or syntax, you may retry with corrected arguments.
- If the error's source is unclear or seems unrelated to your input, do not attempt further retries.
` + (additionalInstructions ? `\n\n${additionalInstructions}` : "")
  );
}
