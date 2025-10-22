import { useRef, useEffect, useCallback, useMemo } from "react";
import { useCopilotContext } from "../context/copilot-context";
import { SystemMessageFunction } from "../types";
import { AppendMessageOptions } from "./use-chat";
import { useAsyncCallback } from "../components/error-boundary/error-utils";
import { Message } from "@copilotkit/shared";
import { gqlToAGUI, Message as DeprecatedGqlMessage } from "@copilotkit/runtime-client-gql";
import { useLangGraphInterruptRender } from "./use-langgraph-interrupt-render";
import {
  useAgent,
  useCopilotChatConfiguration,
  useCopilotKit,
  useSuggestions,
} from "@copilotkitnext/react";
import { randomUUID } from "@copilotkit/shared";
import { Suggestion } from "@copilotkitnext/core";
import { useLazyToolRenderer } from "./use-lazy-tool-renderer";
import {
  useConfigureChatSuggestions,
  UseCopilotChatSuggestionsConfiguration,
} from "./use-configure-chat-suggestions";
import { useAgentSubscribers } from "./use-agent-subscribers";

/**
 * The type of suggestions to use in the chat.
 *
 * `auto` - Suggestions are generated automatically.
 * `manual` - Suggestions are controlled programmatically.
 * `SuggestionItem[]` - Static suggestions array.
 */
export type ChatSuggestions = "auto" | "manual" | Omit<Suggestion, "isLoading">[];

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

  suggestions?: ChatSuggestions;
}

export interface MCPServerConfig {
  endpoint: string;
  apiKey?: string;
}

// Old suggestion item interface, for returning from useCopilotChatInternal
interface SuggestionItem {
  title: string;
  message: string;
  partial?: boolean;
  className?: string;
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

  /** @deprecated use `sendMessage` in `useCopilotChatHeadless_c` instead. This will be removed in a future major version. */
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
  suggestions: Suggestion[];

  /**
   * Manually set suggestions
   * Useful for manual mode or custom suggestion workflows
   */
  setSuggestions: (suggestions: Suggestion[]) => void;

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

  agent?: ReturnType<typeof useAgent>["agent"];

  threadId?: string;
}

function useConfigureSuggestions(suggestions?: UseCopilotChatOptions["suggestions"]) {
  let suggestionsConfig: UseCopilotChatSuggestionsConfiguration;

  if (Array.isArray(suggestions)) {
    suggestionsConfig = {
      suggestions,
      available: "always",
    };
  } else if (suggestions === "auto") {
    suggestionsConfig = {
      available: suggestions === "auto" ? "always" : "disabled",
      instructions:
        "Suggest what the user could say next. Provide clear, highly relevant suggestions. Do not literally suggest function calls.",
    };
  } else {
    suggestionsConfig = { available: "disabled" } as UseCopilotChatSuggestionsConfiguration;
  }

  useConfigureChatSuggestions(suggestionsConfig);
}

export function useCopilotChatInternal({
  suggestions,
}: UseCopilotChatOptions = {}): UseCopilotChatReturn {
  const { copilotkit } = useCopilotKit();
  const { threadId, agentSession } = useCopilotContext();
  const existingConfig = useCopilotChatConfiguration();
  useConfigureSuggestions(suggestions);

  // Apply priority: props > existing config > defaults
  const resolvedAgentId = agentSession?.agentName ?? existingConfig?.agentId ?? "default";
  const resolvedThreadId = useMemo(
    () => threadId ?? existingConfig?.threadId ?? randomUUID(),
    [threadId, existingConfig?.threadId],
  );
  const { agent } = useAgent({ agentId: resolvedAgentId });
  useAgentSubscribers(agent);

  useEffect(() => {
    if (agent) {
      agent.threadId = resolvedThreadId;
    }
    return () => {};
  }, [resolvedThreadId, agent]);

  // @ts-expect-error -- agui client version mismatch causes this
  const interrupt = useLangGraphInterruptRender(agent);

  const reset = () => {
    agent?.setMessages([]);
    agent?.setState(null);
  };

  const deleteMessage = useCallback(
    (messageId: string) => {
      const filteredMessages = (agent?.messages ?? []).filter(
        (message) => message.id !== messageId,
      );
      agent?.setMessages(filteredMessages);
    },
    [agent?.setMessages, agent?.messages],
  );

  const latestDelete = useUpdatedRef(deleteMessage);
  const latestDeleteFunc = useCallback(
    (messageId: string) => {
      return latestDelete.current(messageId);
    },
    [latestDelete],
  );

  const currentSuggestions = useSuggestions();

  const reload = useAsyncCallback(
    async (reloadMessageId: string): Promise<void> => {
      const messages = agent?.messages ?? [];
      // TODO: get isLoading
      const isLoading = false;
      if (isLoading || messages.length === 0) {
        return;
      }

      const reloadMessageIndex = messages.findIndex((msg) => msg.id === reloadMessageId);
      if (reloadMessageIndex === -1) {
        console.warn(`Message with id ${reloadMessageId} not found`);
        return;
      }

      const reloadMessageRole = messages[reloadMessageIndex].role;
      if (reloadMessageRole !== "assistant") {
        console.warn(`Regenerate cannot be performed on ${reloadMessageRole} role`);
        return;
      }
      let historyCutoff: Message[] = [messages[0]];

      if (messages.length > 2 && reloadMessageIndex !== 0) {
        // message to regenerate from is now first.
        // Work backwards to find the first the closest user message
        const lastUserMessageBeforeRegenerate = messages
          .slice(0, reloadMessageIndex)
          .reverse()
          .find(
            (msg) =>
              // @ts-expect-error -- message has role
              msg.role === MessageRole.User,
          );
        const indexOfLastUserMessageBeforeRegenerate = messages.findIndex(
          (msg) => msg.id === lastUserMessageBeforeRegenerate!.id,
        );

        // Include the user message, remove everything after it
        historyCutoff = messages.slice(0, indexOfLastUserMessageBeforeRegenerate + 1);
      } else if (messages.length > 2 && reloadMessageIndex === 0) {
        historyCutoff = [messages[0], messages[1]];
      }

      agent?.setMessages(historyCutoff);

      if (agent) {
        copilotkit.runAgent({ agent });
      }
      return;
    },
    [agent?.setMessages, copilotkit?.runAgent],
  );

  const latestSendMessageFunc = useAsyncCallback(
    async (message: Message, options?: AppendMessageOptions) => {
      if (!agent) return;
      const followUp = options?.followUp ?? true;
      if (options?.clearSuggestions) {
        await copilotkit.clearSuggestions(resolvedAgentId);
      }
      agent?.addMessage(message);
      if (followUp) {
        try {
          await copilotkit.runAgent({ agent });
        } catch (error) {
          console.error("CopilotChat: runAgent failed", error);
        }
      }
    },
    [agent, copilotkit.runAgent],
  );

  const latestAppendFunc = useAsyncCallback(
    async (message: DeprecatedGqlMessage, options?: AppendMessageOptions) => {
      latestSendMessageFunc(gqlToAGUI([message])[0], options);
    },
    [latestSendMessageFunc],
  );

  const latestSetMessages = useUpdatedRef(agent?.setMessages);
  const latestSetMessagesFunc = useCallback(
    (messages: Message[] | DeprecatedGqlMessage[]) => {
      if (messages.every((message) => message instanceof DeprecatedGqlMessage)) {
        return latestSetMessages.current?.(gqlToAGUI(messages));
      }
      return latestSetMessages.current?.(messages);
    },
    [latestSetMessages, agent],
  );

  const latestReload = useUpdatedRef(reload);
  const latestReloadFunc = useAsyncCallback(
    async (messageId: string) => {
      return await latestReload.current(messageId);
    },
    [latestReload],
  );

  const latestStop = useUpdatedRef(agent?.abortRun);
  const latestStopFunc = useCallback(() => {
    return latestStop.current?.();
  }, [latestStop]);

  const latestReset = useUpdatedRef(reset);
  const latestResetFunc = useCallback(() => {
    return latestReset.current();
  }, [latestReset]);

  const lazyToolRendered = useLazyToolRenderer();
  const allMessages = agent?.messages ?? [];
  const resolvedMessages = useMemo(() => {
    return allMessages.map((message) => {
      if (message.role !== "assistant") {
        return message;
      }

      const genUI = lazyToolRendered(message, allMessages);
      return genUI ? { ...message, generativeUI: genUI } : message;
    });
  }, [agent?.messages, lazyToolRendered, allMessages]);

  // @ts-ignore
  return {
    messages: resolvedMessages,
    sendMessage: latestSendMessageFunc,
    appendMessage: latestAppendFunc,
    setMessages: latestSetMessagesFunc,
    reloadMessages: latestReloadFunc,
    stopGeneration: latestStopFunc,
    reset: latestResetFunc,
    deleteMessage: latestDeleteFunc,
    isLoading: agent?.isRunning ?? false,
    // mcpServers,
    // setMcpServers,
    suggestions: currentSuggestions.suggestions,
    setSuggestions: (suggestions: Suggestion[]) => copilotkit.addSuggestionsConfig({ suggestions }),
    generateSuggestions: async () => copilotkit.reloadSuggestions(resolvedAgentId),
    resetSuggestions: () => copilotkit.clearSuggestions(resolvedAgentId),
    isLoadingSuggestions: currentSuggestions.isLoading,
    interrupt,
    agent,
    threadId,
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
