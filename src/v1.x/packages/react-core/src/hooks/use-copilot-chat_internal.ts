import { useRef, useEffect, useCallback, useMemo, useState, createElement } from "react";
import { useCopilotContext } from "../context/copilot-context";
import { SystemMessageFunction } from "../types";
import { useAsyncCallback } from "../components/error-boundary/error-utils";
import { Message } from "@copilotkit/shared";
import { gqlToAGUI, Message as DeprecatedGqlMessage } from "@copilotkit/runtime-client-gql";
import { useLangGraphInterruptRender } from "./use-langgraph-interrupt-render";
import {
  useAgent,
  useCopilotChatConfiguration,
  useCopilotKit,
  useRenderCustomMessages,
  useSuggestions,
} from "@copilotkitnext/react";
import { Suggestion } from "@copilotkitnext/core";
import { useLazyToolRenderer } from "./use-lazy-tool-renderer";
import { AbstractAgent, AGUIConnectNotImplementedError } from "@ag-ui/client";
import {
  CoAgentStateRenderBridge,
  type CoAgentStateRenderBridgeProps,
} from "./use-coagent-state-render-bridge";

/**
 * The type of suggestions to use in the chat.
 *
 * `auto` - Suggestions are generated automatically.
 * `manual` - Suggestions are controlled programmatically.
 * `SuggestionItem[]` - Static suggestions array.
 */
export type ChatSuggestions = "auto" | "manual" | Omit<Suggestion, "isLoading">[];

export interface AppendMessageOptions {
  /**
   * Whether to run the chat completion after appending the message. Defaults to `true`.
   */
  followUp?: boolean;
  /**
   * Whether to clear the suggestions after appending the message. Defaults to `true`.
   */
  clearSuggestions?: boolean;
}

export interface OnStopGenerationArguments {
  /**
   * The name of the currently executing agent.
   */
  currentAgentName: string | undefined;

  /**
   * The messages in the chat.
   */
  messages: Message[];
}

export type OnReloadMessagesArguments = OnStopGenerationArguments & {
  /**
   * The message on which "regenerate" was pressed
   */
  messageId: string;
};

export type OnStopGeneration = (args: OnStopGenerationArguments) => void;

export type OnReloadMessages = (args: OnReloadMessagesArguments) => void;

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
  /**
   * Controls the behavior of suggestions in the chat interface.
   *
   * `auto` (default) - Suggestions are generated automatically:
   *   - When the chat is first opened (empty state)
   *   - After each message exchange completes
   *   - Uses configuration from `useCopilotChatSuggestions` hooks
   *
   * `manual` - Suggestions are controlled programmatically:
   *   - Use `setSuggestions()` to set custom suggestions
   *   - Use `generateSuggestions()` to trigger AI generation
   *   - Access via `useCopilotChat` hook
   *
   * `SuggestionItem[]` - Static suggestions array:
   *   - Always shows the same suggestions
   *   - No AI generation involved
   */
  suggestions?: ChatSuggestions;

  onInProgress?: (isLoading: boolean) => void;
  onSubmitMessage?: (messageContent: string) => Promise<void> | void;
  onStopGeneration?: OnStopGeneration;
  onReloadMessages?: OnReloadMessages;
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

  /**
   * Whether the chat agent is available to generate responses
   *
   * ```tsx
   * if (isAvailable) {
   *   console.log("Loading...");
   * } else {
   *   console.log("Not loading");
   * }
   */
  isAvailable: boolean;

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
  setSuggestions: (suggestions: Omit<Suggestion, "isLoading">[]) => void;

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

export function useCopilotChatInternal({
  suggestions,
  onInProgress,
  onSubmitMessage,
  onStopGeneration,
  onReloadMessages,
}: UseCopilotChatOptions = {}): UseCopilotChatReturn {
  const { copilotkit } = useCopilotKit();
  const { threadId, agentSession } = useCopilotContext();
  const existingConfig = useCopilotChatConfiguration();
  const [agentAvailable, setAgentAvailable] = useState(false);

  // Apply priority: props > existing config > defaults
  const resolvedAgentId = existingConfig?.agentId ?? "default";
  const { agent } = useAgent({ agentId: resolvedAgentId });

  useEffect(() => {
    const connect = async (agent: AbstractAgent) => {
      setAgentAvailable(false);
      try {
        await copilotkit.connectAgent({ agent });
        setAgentAvailable(true);
      } catch (error) {
        if (error instanceof AGUIConnectNotImplementedError) {
          // connect not implemented, ignore
        } else {
          console.error("CopilotChat: connectAgent failed", error);
          // Error will be reported through subscription
        }
      }
    };
    if (agent && existingConfig?.threadId && agent.threadId !== existingConfig.threadId) {
      agent.threadId = existingConfig.threadId;
      connect(agent);
    }
    return () => {};
  }, [existingConfig?.threadId, agent, copilotkit, resolvedAgentId]);

  useEffect(() => {
    onInProgress?.(Boolean(agent?.isRunning));
  }, [agent?.isRunning, onInProgress]);

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

  const currentSuggestions = useSuggestions({ agentId: resolvedAgentId });

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
          .find((msg) => msg.role === "user");

        if (!lastUserMessageBeforeRegenerate) {
          historyCutoff = [messages[0]];
        } else {
          const indexOfLastUserMessageBeforeRegenerate = messages.findIndex(
            (msg) => msg.id === lastUserMessageBeforeRegenerate.id,
          );
          // Include the user message, remove everything after it
          historyCutoff = messages.slice(0, indexOfLastUserMessageBeforeRegenerate + 1);
        }
      } else if (messages.length > 2 && reloadMessageIndex === 0) {
        historyCutoff = [messages[0], messages[1]];
      }

      agent?.setMessages(historyCutoff);

      if (agent) {
        try {
          await copilotkit.runAgent({ agent });
        } catch (error) {
          console.error("CopilotChat: runAgent failed during reload", error);
          // Error will be reported through subscription
        }
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
        copilotkit.clearSuggestions(resolvedAgentId);
      }

      // Call onSubmitMessage BEFORE adding message and running agent
      // This allows users to perform actions (e.g., open chat window) before agent starts processing
      if (onSubmitMessage) {
        const content =
          typeof message.content === "string"
            ? message.content
            : message.content && "text" in message.content
              ? message.content.text
              : message.content && "filename" in message.content
                ? message.content.filename
                : "";
        try {
          await onSubmitMessage(content);
        } catch (error) {
          console.error("Error in onSubmitMessage:", error);
        }
      }

      agent?.addMessage(message);
      if (followUp) {
        try {
          await copilotkit.runAgent({ agent });
        } catch (error) {
          console.error("CopilotChat: runAgent failed", error);
          // Error will be reported through subscription
        }
      }
    },
    [agent, copilotkit, resolvedAgentId, onSubmitMessage],
  );

  const latestAppendFunc = useAsyncCallback(
    async (message: DeprecatedGqlMessage, options?: AppendMessageOptions) => {
      return latestSendMessageFunc(gqlToAGUI([message])[0], options);
    },
    [latestSendMessageFunc],
  );

  const latestSetMessagesFunc = useCallback(
    (messages: Message[] | DeprecatedGqlMessage[]) => {
      if (messages.every((message) => message instanceof DeprecatedGqlMessage)) {
        return agent?.setMessages?.(gqlToAGUI(messages));
      }
      return agent?.setMessages?.(messages);
    },
    [agent?.setMessages, agent],
  );

  const latestReload = useUpdatedRef(reload);
  const latestReloadFunc = useAsyncCallback(
    async (messageId: string) => {
      onReloadMessages?.({
        messageId,
        currentAgentName: agent?.agentId,
        messages: agent?.messages ?? [],
      });
      return await latestReload.current(messageId);
    },
    [latestReload, agent, onReloadMessages],
  );

  const latestStopFunc = useCallback(() => {
    onStopGeneration?.({
      currentAgentName: agent?.agentId,
      messages: agent?.messages ?? [],
    });
    return agent?.abortRun?.();
  }, [onStopGeneration, agent]);

  const latestReset = useUpdatedRef(reset);
  const latestResetFunc = useCallback(() => {
    return latestReset.current();
  }, [latestReset]);

  const lazyToolRendered = useLazyToolRenderer();
  const renderCustomMessage = useRenderCustomMessages();
  const legacyCustomMessageRenderer = useLegacyCoagentRenderer({
    copilotkit,
    agent,
    agentId: resolvedAgentId,
    threadId: existingConfig?.threadId ?? threadId,
  });
  const allMessages = agent?.messages ?? [];
  const resolvedMessages = useMemo(() => {
    let processedMessages = allMessages.map((message) => {
      if (message.role !== "assistant") {
        return message;
      }

      const lazyRendered = lazyToolRendered(message, allMessages);
      if (lazyRendered) {
        const renderedGenUi = lazyRendered();
        if (renderedGenUi) {
          return { ...message, generativeUI: () => renderedGenUi };
        }
      }

      const bridgeRenderer =
        legacyCustomMessageRenderer || renderCustomMessage
          ? () => {
              if (legacyCustomMessageRenderer) {
                return legacyCustomMessageRenderer({ message, position: "before" });
              }
              try {
                return renderCustomMessage?.({ message, position: "before" }) ?? null;
              } catch (error) {
                console.warn(
                  "[CopilotKit] renderCustomMessages failed, falling back to legacy renderer",
                  error,
                );
                return null;
              }
            }
          : null;

      if (bridgeRenderer) {
        // Attach a position so react-ui can render the custom UI above the assistant content.
        return {
          ...message,
          generativeUI: bridgeRenderer,
          generativeUIPosition: "before" as const,
        };
      }
      return message;
    });

    const hasAssistantMessages = processedMessages.some((msg) => msg.role === "assistant");
    const canUseCustomRenderer = Boolean(
      renderCustomMessage && copilotkit?.getAgent?.(resolvedAgentId),
    );
    const placeholderRenderer = legacyCustomMessageRenderer
      ? legacyCustomMessageRenderer
      : canUseCustomRenderer
        ? renderCustomMessage
        : null;

    const shouldRenderPlaceholder =
      Boolean(agent?.isRunning) || Boolean(agent?.state && Object.keys(agent.state).length);

    const effectiveThreadId = threadId ?? agent?.threadId ?? "default";
    let latestUserIndex = -1;
    for (let i = processedMessages.length - 1; i >= 0; i -= 1) {
      if (processedMessages[i].role === "user") {
        latestUserIndex = i;
        break;
      }
    }
    const latestUserMessageId =
      latestUserIndex >= 0 ? processedMessages[latestUserIndex].id : undefined;
    const currentRunId = latestUserMessageId
      ? copilotkit.getRunIdForMessage(resolvedAgentId, effectiveThreadId, latestUserMessageId) ||
        `pending:${latestUserMessageId}`
      : undefined;
    const hasAssistantForCurrentRun =
      latestUserIndex >= 0
        ? processedMessages
            .slice(latestUserIndex + 1)
            .some((msg) => msg.role === "assistant")
        : hasAssistantMessages;

    // Insert a placeholder assistant message so state snapshots can render before any
    // assistant text exists for the current run.
    if (placeholderRenderer && shouldRenderPlaceholder && !hasAssistantForCurrentRun) {
      const placeholderId = currentRunId
        ? `coagent-state-render-${resolvedAgentId}-${currentRunId}`
        : `coagent-state-render-${resolvedAgentId}`;
      const placeholderMessage: Message = {
        id: placeholderId,
        role: "assistant",
        content: "",
        name: "coagent-state-render",
        runId: currentRunId,
      };
      processedMessages = [
        ...processedMessages,
        {
          ...placeholderMessage,
          generativeUIPosition: "before" as const,
          generativeUI: () =>
            placeholderRenderer({
              message: placeholderMessage,
              position: "before",
            }),
        } as Message,
      ];
    }

    return processedMessages;
  }, [
    agent?.messages,
    lazyToolRendered,
    allMessages,
    renderCustomMessage,
    legacyCustomMessageRenderer,
    resolvedAgentId,
    copilotkit,
    agent?.isRunning,
    agent?.state,
  ]);

  const renderedSuggestions = useMemo(() => {
    if (Array.isArray(suggestions)) {
      return {
        suggestions: suggestions.map((s) => ({ ...s, isLoading: false })),
        isLoading: false,
      };
    }
    return currentSuggestions;
  }, [suggestions, currentSuggestions]);

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
    isAvailable: agentAvailable,
    isLoading: Boolean(agent?.isRunning),
    // mcpServers,
    // setMcpServers,
    suggestions: renderedSuggestions.suggestions,
    setSuggestions: (suggestions: Omit<Suggestion, "isLoading">[]) =>
      copilotkit.addSuggestionsConfig({ suggestions }),
    generateSuggestions: async () => copilotkit.reloadSuggestions(resolvedAgentId),
    resetSuggestions: () => copilotkit.clearSuggestions(resolvedAgentId),
    isLoadingSuggestions: renderedSuggestions.isLoading,
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

type LegacyRenderParams = {
  message: Message;
  position: "before" | "after";
};

type LegacyRenderer = ((args: LegacyRenderParams) => any) | null;

function useLegacyCoagentRenderer({
  copilotkit,
  agent,
  agentId,
  threadId,
}: {
  copilotkit: ReturnType<typeof useCopilotKit>["copilotkit"];
  agent?: AbstractAgent;
  agentId: string;
  threadId?: string;
}): LegacyRenderer {
  return useMemo(() => {
    if (!copilotkit || !agent) {
      return null;
    }

    return ({ message, position }: LegacyRenderParams) => {
      const effectiveThreadId = threadId ?? agent.threadId ?? "default";
      const providedRunId = (message as any).runId as string | undefined;
      const existingRunId = providedRunId
        ? providedRunId
        : copilotkit.getRunIdForMessage(agentId, effectiveThreadId, message.id);
      const runId = existingRunId || `pending:${message.id}`;
      const messageIndex = Math.max(
        agent.messages.findIndex((msg) => msg.id === message.id),
        0,
      );

      const bridgeProps: CoAgentStateRenderBridgeProps = {
        message: message as any,
        position,
        runId,
        messageIndex,
        messageIndexInRun: 0,
        numberOfMessagesInRun: 1,
        agentId,
        stateSnapshot: (message as any).state,
      };

      return createElement(CoAgentStateRenderBridge, bridgeProps) as any;
    };
  }, [agent, agentId, copilotkit, threadId]);
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
