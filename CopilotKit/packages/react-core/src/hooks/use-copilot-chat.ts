/**
 * A hook for accessing Copilot's chat API.
 *
 * `useCopilotChat` is a React hook that lets you directly interact with the
 * Copilot instance. Use to implement a fully custom UI (headless UI) or to
 * programmatically interact with the Copilot instance managed by the default
 * UI.
 *
 * <RequestExample>
 *   ```jsx useCopilotChat Example
 *   import { useCopilotChat }
 *     from "@copilotkit/react-core";
 *
 *   const { appendMessage } = useCopilotChat();
 *   appendMessage({ content: "Hello, world!", role: "user", id: "1" });
 *   ```
 * </RequestExample>
 *
 * useCopilotChat returns an object with the following properties:
 * - `visibleMessages`: An array of messages that are currently visible in the chat.
 * - `appendMessage`: A function to append a message to the chat.
 * - `setMessages`: A function to set the messages in the chat.
 * - `deleteMessage`: A function to delete a message from the chat.
 * - `reloadMessages`: A function to reload the messages from the API.
 * - `stopGeneration`: A function to stop the generation of the next message.
 * - `isLoading`: A boolean indicating if the chat is loading.
 *
 */
import { useMemo, useContext, useRef, useEffect, useCallback } from "react";
import { CopilotContext } from "../context/copilot-context";
import { Message, ToolDefinition } from "@copilotkit/shared";
import { SystemMessageFunction } from "../types";
import { useChat } from "./use-chat";
import { defaultCopilotContextCategories } from "../components";

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
   * Extra body object to be sent with the API request.
   * @example
   * Send a `sessionId` to the API along with the messages.
   * ```js
   * useChat({
   *   body: {
   *     sessionId: '123',
   *   }
   * })
   * ```
   */
  body?: object;
  /**
   * System messages of the chat. Defaults to an empty array.
   */
  initialMessages?: Message[];

  /**
   * A function to generate the system message. Defaults to `defaultSystemMessage`.
   */
  makeSystemMessage?: SystemMessageFunction;
}

export interface UseCopilotChatReturn {
  visibleMessages: Message[];
  appendMessage: (message: Message) => Promise<void>;
  setMessages: (messages: Message[]) => void;
  deleteMessage: (messageId: string) => void;
  reloadMessages: () => Promise<void>;
  stopGeneration: () => void;
  isLoading: boolean;
}

export function useCopilotChat({
  makeSystemMessage,
  ...options
}: UseCopilotChatOptions = {}): UseCopilotChatReturn {
  const {
    getContextString,
    getChatCompletionFunctionDescriptions,
    getFunctionCallHandler,
    copilotApiConfig,
    messages,
    setMessages,
    isLoading,
    setIsLoading,
    chatInstructions,
    actions,
  } = useContext(CopilotContext);

  // We need to ensure that makeSystemMessageCallback always uses the latest
  // useCopilotReadable data.
  const latestGetContextString = useUpdatedRef(getContextString);
  const deleteMessage = useCallback(
    (messageId: string) => {
      setMessages((prev) => prev.filter((message) => message.id !== messageId));
    },
    [setMessages],
  );

  const makeSystemMessageCallback = useCallback(() => {
    const systemMessageMaker = makeSystemMessage || defaultSystemMessage;
    // this always gets the latest context string
    const contextString = latestGetContextString.current([], defaultCopilotContextCategories); // TODO: make the context categories configurable

    return {
      id: "system",
      content: systemMessageMaker(contextString, chatInstructions),
      role: "system",
    } as Message;
  }, [getContextString, makeSystemMessage, chatInstructions]);

  const functionDescriptions: ToolDefinition[] = useMemo(() => {
    return getChatCompletionFunctionDescriptions();
  }, [getChatCompletionFunctionDescriptions]);

  const { append, reload, stop } = useChat({
    ...options,
    actions: Object.values(actions),
    copilotConfig: copilotApiConfig,
    initialMessages: options.initialMessages || [],
    onFunctionCall: getFunctionCallHandler(),
    messages,
    setMessages,
    makeSystemMessageCallback,
    isLoading,
    setIsLoading,
  });

  const visibleMessages = messages.filter(
    (message) =>
      message.role === "user" || message.role === "assistant" || message.role === "function",
  );

  return {
    visibleMessages,
    appendMessage: append,
    setMessages,
    reloadMessages: reload,
    stopGeneration: stop,
    deleteMessage,
    isLoading,
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
` + (additionalInstructions ? `\n\n${additionalInstructions}` : "")
  );
}
