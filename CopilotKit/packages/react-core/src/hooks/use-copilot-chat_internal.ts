import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { AgentSession, useCopilotContext, CopilotContextParams } from "../context/copilot-context";
import { useCopilotMessagesContext, CopilotMessagesContextParams } from "../context";
import { SystemMessageFunction } from "../types";
import { useChat, AppendMessageOptions } from "./use-chat";
import { defaultCopilotContextCategories } from "../components";
import { CoAgentStateRenderHandlerArguments } from "@copilotkit/shared";
import { useAsyncCallback } from "../components/error-boundary/error-utils";
import { reloadSuggestions as generateSuggestions } from "../utils";
import type { SuggestionItem } from "../utils";

import { Message } from "@copilotkit/shared";
import {
  Role as gqlRole,
  TextMessage,
  aguiToGQL,
  gqlToAGUI,
  Message as DeprecatedGqlMessage,
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
   * Initial messages to populate the chat with.
   */
  initialMessages?: Message[];

  /**
   * A function to generate the system message. Defaults to `defaultSystemMessage`.
   */
  makeSystemMessage?: SystemMessageFunction;

  /**
   * Disables inclusion of CopilotKit’s default system message. When true, no system message is sent (this also suppresses any custom message from <code>makeSystemMessage</code>).
   */
  disableSystemMessage?: boolean;
}

export interface MCPServerConfig {
  endpoint: string;
  apiKey?: string;
}

export interface UseCopilotChatReturn {
  /**
   * @deprecated use `messages` instead, this is an old non ag-ui version of the messages
   * Array of messages currently visible in the chat interface
   *
   * This is the visible messages, not the raw messages from the runtime client.
   */
  visibleMessages: DeprecatedGqlMessage[];

  /**
   * The messages that are currently in the chat in AG-UI format.
   */
  messages: Message[];

  /** @deprecated use `sendMessage` instead */
  appendMessage: (message: DeprecatedGqlMessage, options?: AppendMessageOptions) => Promise<void>;

  /**
   * Send a new message to the chat
   *
   * ```tsx
   * await sendMessage({
   *   id: "123",
   *   role: "user",
   *   content: "Hello, process this request",
   * });
   * ```
   */
  sendMessage: (message: Message, options?: AppendMessageOptions) => Promise<void>;

  /**
   * Replace all messages in the chat
   *
   * ```tsx
   * setMessages([
   *   { id: "123", role: "user", content: "Hello, process this request" },
   *   { id: "456", role: "assistant", content: "Hello, I'm the assistant" },
   * ]);
   * ```
   *
   * **Deprecated** non-ag-ui version:
   *
   * ```tsx
   * setMessages([
   *   new TextMessage({
   *     content: "Hello, process this request",
   *     role: gqlRole.User,
   *   }),
   *   new TextMessage({
   *     content: "Hello, I'm the assistant",
   *     role: gqlRole.Assistant,
   * ]);
   * ```
   *
   */
  setMessages: (messages: Message[] | DeprecatedGqlMessage[]) => void;

  /**
   * Remove a specific message by ID
   *
   * ```tsx
   * deleteMessage("123");
   * ```
   */
  deleteMessage: (messageId: string) => void;

  /**
   * Regenerate the response for a specific message
   *
   * ```tsx
   * reloadMessages("123");
   * ```
   */
  reloadMessages: (messageId: string) => Promise<void>;

  /**
   * Stop the current message generation
   *
   * ```tsx
   * if (isLoading) {
   *   stopGeneration();
   * }
   * ```
   */
  stopGeneration: () => void;

  /**
   * Clear all messages and reset chat state
   *
   * ```tsx
   * reset();
   * console.log(messages); // []
   * ```
   */
  reset: () => void;

  /**
   * Whether the chat is currently generating a response
   *
   * ```tsx
   * if (isLoading) {
   *   console.log("Loading...");
   * } else {
   *   console.log("Not loading");
   * }
   */
  isLoading: boolean;

  /** Manually trigger chat completion (advanced usage) */
  runChatCompletion: () => Promise<Message[]>;

  /** MCP (Model Context Protocol) server configurations */
  mcpServers: MCPServerConfig[];

  /** Update MCP server configurations */
  setMcpServers: (mcpServers: MCPServerConfig[]) => void;

  /**
   * Current suggestions array
   * Use this to read the current suggestions or in conjunction with setSuggestions for manual control
   */
  suggestions: SuggestionItem[];

  /**
   * Manually set suggestions
   * Useful for manual mode or custom suggestion workflows
   */
  setSuggestions: (suggestions: SuggestionItem[]) => void;

  /**
   * Trigger AI-powered suggestion generation
   * Uses configurations from useCopilotChatSuggestions hooks
   * Respects global debouncing - only one generation can run at a time
   *
   * ```tsx
   * generateSuggestions();
   * console.log(suggestions); // [suggestion1, suggestion2, suggestion3]
   * ```
   */
  generateSuggestions: () => Promise<void>;

  /**
   * Clear all current suggestions
   * Also resets suggestion generation state
   */
  resetSuggestions: () => void;

  /** Whether suggestions are currently being generated */
  isLoadingSuggestions: boolean;

  /** Interrupt content for human-in-the-loop workflows */
  interrupt: string | React.ReactElement | null;
}

let globalSuggestionPromise: Promise<void> | null = null;

export function useCopilotChat(options: UseCopilotChatOptions = {}): UseCopilotChatReturn {
  const makeSystemMessage = options.makeSystemMessage ?? defaultSystemMessage;
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

    runtimeClient,
  } = useCopilotContext();
  const { messages, setMessages, suggestions, setSuggestions } = useCopilotMessagesContext();

  // Simple state for MCP servers (keep for interface compatibility)
  const [mcpServers, setLocalMcpServers] = useState<MCPServerConfig[]>([]);

  // Basic suggestion state for programmatic control
  const suggestionsAbortControllerRef = useRef<AbortController | null>(null);
  const isLoadingSuggestionsRef = useRef<boolean>(false);

  const abortSuggestions = useCallback(
    (clear: boolean = true) => {
      suggestionsAbortControllerRef.current?.abort("suggestions aborted by user");
      suggestionsAbortControllerRef.current = null;
      if (clear) {
        setSuggestions([]);
      }
    },
    [setSuggestions],
  );

  // Memoize context with stable dependencies only
  const stableContext = useMemo(() => {
    return {
      actions,
      copilotApiConfig,
      chatSuggestionConfiguration,
      messages,
      setMessages,
      getContextString,
      runtimeClient,
    };
  }, [
    JSON.stringify(Object.keys(actions)),
    copilotApiConfig.chatApiEndpoint,
    messages.length,
    Object.keys(chatSuggestionConfiguration).length,
  ]);

  // Programmatic suggestion generation function
  const generateSuggestionsFunc = useCallback(async () => {
    // If a global suggestion is running, ignore this call
    if (globalSuggestionPromise) {
      return globalSuggestionPromise;
    }

    globalSuggestionPromise = (async () => {
      try {
        abortSuggestions();
        isLoadingSuggestionsRef.current = true;
        suggestionsAbortControllerRef.current = new AbortController();

        setSuggestions([]);

        await generateSuggestions(
          stableContext as CopilotContextParams & CopilotMessagesContextParams,
          chatSuggestionConfiguration,
          setSuggestions,
          suggestionsAbortControllerRef,
        );
      } catch (error) {
        // Re-throw to allow caller to handle the error
        throw error;
      } finally {
        isLoadingSuggestionsRef.current = false;
        globalSuggestionPromise = null;
      }
    })();

    return globalSuggestionPromise;
  }, [stableContext, chatSuggestionConfiguration, setSuggestions, abortSuggestions]);

  const resetSuggestions = useCallback(() => {
    setSuggestions([]);
  }, [setSuggestions]);

  // MCP servers logic
  useEffect(() => {
    if (mcpServers.length > 0) {
      const serversCopy = [...mcpServers];
      copilotApiConfig.mcpServers = serversCopy;
      if (!copilotApiConfig.properties) {
        copilotApiConfig.properties = {};
      }
      copilotApiConfig.properties.mcpServers = serversCopy;
    }
  }, [mcpServers, copilotApiConfig]);

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
    disableSystemMessage: options.disableSystemMessage,
  });

  const latestAppend = useUpdatedRef(append);
  const latestAppendFunc = useAsyncCallback(
    async (message: DeprecatedGqlMessage, options?: AppendMessageOptions) => {
      abortSuggestions(options?.clearSuggestions);
      return await latestAppend.current(message, options);
    },
    [latestAppend],
  );

  const latestSendMessageFunc = useAsyncCallback(
    async (message: Message, options?: AppendMessageOptions) => {
      abortSuggestions(options?.clearSuggestions);
      return await latestAppend.current(aguiToGQL([message])[0] as DeprecatedGqlMessage, options);
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
    (messages: Message[] | DeprecatedGqlMessage[]) => {
      if (messages.every((message) => message instanceof DeprecatedGqlMessage)) {
        return latestSetMessages.current(messages as DeprecatedGqlMessage[]);
      }
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
    // Reset suggestions when chat is reset
    resetSuggestions();
  }, [
    latestStopFunc,
    setMessages,
    setThreadId,
    setCoagentStatesWithRef,
    setAgentSession,
    agentLock,
    resetSuggestions,
  ]);

  const latestReset = useUpdatedRef(reset);
  const latestResetFunc = useCallback(() => {
    return latestReset.current();
  }, [latestReset]);

  const interrupt = useLangGraphInterruptRender();

  return {
    visibleMessages: messages,
    messages: gqlToAGUI(messages, actions, coAgentStateRenders),
    sendMessage: latestSendMessageFunc,
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
    generateSuggestions: generateSuggestionsFunc,
    resetSuggestions,
    isLoadingSuggestions: isLoadingSuggestionsRef.current,
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
