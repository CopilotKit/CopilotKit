import { useMemo, useContext, useRef, useEffect, useCallback } from "react";
import { CopilotContext } from "../context/copilot-context";
import { Message, ToolDefinition } from "@copilotkit/shared";
import { SystemMessageFunction } from "../types";
import { UseChatOptions, useChat } from "./use-chat";
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

  /**
   * Additional instructions to the system message.
   */
  additionalInstructions?: string;
}

export interface UseCopilotChatReturn {
  visibleMessages: Message[];
  appendMessage: (message: Message) => Promise<void>;
  reloadMessages: () => Promise<void>;
  stopGeneration: () => void;
  isLoading: boolean;
}

export function useCopilotChat({
  makeSystemMessage,
  additionalInstructions,
  ...options
}: UseCopilotChatOptions): UseCopilotChatReturn {
  const {
    getContextString,
    getChatCompletionFunctionDescriptions,
    getFunctionCallHandler,
    copilotApiConfig,
    messages,
    setMessages,
    isLoading,
    setIsLoading,
  } = useContext(CopilotContext);

  // To ensure that useChat always has the latest readables, we store `getContextString` in a ref and update
  // it whenever it changes.
  const latestGetContextString = useRef(getContextString);
  useEffect(() => {
    latestGetContextString.current = getContextString;
  }, [getContextString]);

  const makeSystemMessageCallback = useCallback(() => {
    const systemMessageMaker = makeSystemMessage || defaultSystemMessage;
    // this always gets the latest context string
    const contextString = latestGetContextString.current([], defaultCopilotContextCategories); // TODO: make the context categories configurable

    return {
      id: "system",
      content: systemMessageMaker(contextString, additionalInstructions),
      role: "system",
    } as Message;
  }, [getContextString, makeSystemMessage, additionalInstructions]);

  const functionDescriptions: ToolDefinition[] = useMemo(() => {
    return getChatCompletionFunctionDescriptions();
  }, [getChatCompletionFunctionDescriptions]);

  const { append, reload, stop } = useChat({
    ...options,
    copilotConfig: copilotApiConfig,
    id: options.id,
    initialMessages: options.initialMessages || [],
    tools: functionDescriptions,
    onFunctionCall: getFunctionCallHandler(),
    headers: { ...options.headers },
    body: {
      ...options.body,
    },
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
    reloadMessages: reload,
    stopGeneration: stop,
    isLoading,
  };
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
