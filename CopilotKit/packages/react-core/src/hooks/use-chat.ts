import { useRef, useState } from "react";
import { Message, ToolDefinition, FunctionCallHandler } from "@copilotkit/shared";
import { nanoid } from "nanoid";
import { fetchAndDecodeChatCompletion } from "../utils/fetch-chat-completion";
import { CopilotApiConfig } from "../context";

export type UseChatOptions = {
  /**
   * The API endpoint that accepts a `{ messages: Message[] }` object and returns
   * a stream of tokens of the AI chat response. Defaults to `/api/chat`.
   */
  api?: string;
  /**
   * A unique identifier for the chat. If not provided, a random one will be
   * generated. When provided, the `useChat` hook with the same `id` will
   * have shared states across components.
   */
  id?: string;
  /**
   * System messages of the chat. Defaults to an empty array.
   */
  initialMessages?: Message[];
  /**
   * Callback function to be called when a function call is received.
   * If the function returns a `ChatRequest` object, the request will be sent
   * automatically to the API and will be used to update the chat.
   */
  onFunctionCall?: FunctionCallHandler;
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
   * Function definitions to be sent to the API.
   */
  tools?: ToolDefinition[];
};

export type UseChatHelpers = {
  /** Current messages in the chat */
  messages: Message[];
  /**
   * Append a user message to the chat list. This triggers the API call to fetch
   * the assistant's response.
   * @param message The message to append
   */
  append: (message: Message) => Promise<void>;
  /**
   * Reload the last AI chat response for the given chat history. If the last
   * message isn't from the assistant, it will request the API to generate a
   * new response.
   */
  reload: () => Promise<void>;
  /**
   * Abort the current request immediately, keep the generated tokens if any.
   */
  stop: () => void;
  /** The current value of the input */
  input: string;
  /** setState-powered method to update the input value */
  setInput: React.Dispatch<React.SetStateAction<string>>;
  /** Whether the API request is in progress */
  isLoading: boolean;
};

export type UseChatOptionsWithCopilotConfig = UseChatOptions & {
  copilotConfig: CopilotApiConfig;
};

export function useChat(options: UseChatOptionsWithCopilotConfig): UseChatHelpers {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef<AbortController>();

  const runChatCompletion = async (messages: Message[]): Promise<Message[]> => {
    setIsLoading(true);

    const newMessages: Message[] = [
      {
        id: nanoid(),
        createdAt: new Date(),
        content: "",
        role: "assistant",
      },
    ];
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setMessages([...messages, ...newMessages]);

    const messagesWithContext = [...(options.initialMessages || []), ...messages];
    const response = await fetchAndDecodeChatCompletion({
      copilotConfig: options.copilotConfig,
      messages: messagesWithContext,
      tools: options.tools,
      headers: options.headers,
      signal: abortController.signal,
    });

    if (!response.events) {
      throw new Error("Failed to fetch chat completion");
    }

    const reader = response.events.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          return newMessages.slice();
        }

        let currentMessage = Object.assign({}, newMessages[newMessages.length - 1]);

        if (value.type === "content") {
          if (currentMessage.function_call) {
            // Create a new message if the previous one is a function call
            currentMessage = {
              id: nanoid(),
              createdAt: new Date(),
              content: "",
              role: "assistant",
            };
            newMessages.push(currentMessage);
          }
          currentMessage.content += value.content;
          newMessages[newMessages.length - 1] = currentMessage;
          setMessages([...messages, ...newMessages]);
        } else if (value.type === "function") {
          // Create a new message if the previous one is not empty
          if (currentMessage.content != "" || currentMessage.function_call) {
            currentMessage = {
              id: nanoid(),
              createdAt: new Date(),
              content: "",
              role: "assistant",
            };
            newMessages.push(currentMessage);
          }
          currentMessage.function_call = {
            name: value.name,
            arguments: JSON.stringify(value.arguments),
          };

          newMessages[newMessages.length - 1] = currentMessage;
          setMessages([...messages, ...newMessages]);

          // Execute the function call
          await options.onFunctionCall?.(messages, currentMessage.function_call);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const runChatCompletionAndHandleFunctionCall = async (messages: Message[]): Promise<void> => {
    await runChatCompletion(messages);
  };

  const append = async (message: Message): Promise<void> => {
    if (isLoading) {
      return;
    }
    const newMessages = [...messages, message];
    setMessages(newMessages);
    return runChatCompletionAndHandleFunctionCall(newMessages);
  };

  const reload = async (): Promise<void> => {
    if (isLoading || messages.length === 0) {
      return;
    }
    let newMessages = [...messages];
    const lastMessage = messages[messages.length - 1];

    if (lastMessage.role === "assistant") {
      newMessages = newMessages.slice(0, -1);
    }
    setMessages(newMessages);

    return runChatCompletionAndHandleFunctionCall(newMessages);
  };

  const stop = (): void => {
    abortControllerRef.current?.abort();
  };

  return {
    messages,
    append,
    reload,
    stop,
    isLoading,
    input,
    setInput,
  };
}
