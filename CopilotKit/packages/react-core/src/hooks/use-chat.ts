import { useRef, useState } from "react";
import {
  Message,
  ToolDefinition,
  FunctionCallHandler,
  encodeResult,
  FunctionCall,
  COPILOT_CLOUD_PUBLIC_API_KEY_HEADER,
} from "@copilotkit/shared";

import { nanoid } from "nanoid";
import { fetchAndDecodeChatCompletion } from "../utils/fetch-chat-completion";
import { CopilotApiConfig } from "../context";
import untruncateJson from "untruncate-json";

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
  /**
   * The current list of messages in the chat.
   */
  messages: Message[];
  /**
   * The setState-powered method to update the chat messages.
   */
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
};

export function useChat(options: UseChatOptionsWithCopilotConfig): UseChatHelpers {
  const { messages, setMessages } = options;
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef<AbortController>();
  const threadIdRef = useRef<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const publicApiKey = options.copilotConfig.publicApiKey;
  const headers = {
    ...(options.headers || {}),
    ...(publicApiKey ? { [COPILOT_CLOUD_PUBLIC_API_KEY_HEADER]: publicApiKey } : {}),
  };

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

    // add threadId and runId to the body if it exists
    const copilotConfigBody = options.copilotConfig.body || {};
    if (threadIdRef.current) {
      copilotConfigBody.threadId = threadIdRef.current;
    }
    if (runIdRef.current) {
      copilotConfigBody.runId = runIdRef.current;
    }

    const messagesWithContext = [...(options.initialMessages || []), ...messages];
    const response = await fetchAndDecodeChatCompletion({
      copilotConfig: { ...options.copilotConfig, body: copilotConfigBody },
      messages: messagesWithContext,
      tools: options.tools,
      headers: headers,
      signal: abortController.signal,
    });

    if (response.headers.get("threadid")) {
      threadIdRef.current = response.headers.get("threadid");
    }

    if (response.headers.get("runid")) {
      runIdRef.current = response.headers.get("runid");
    }

    if (!response.events) {
      setMessages([
        ...messages,
        {
          id: nanoid(),
          createdAt: new Date(),
          content: response.statusText,
          role: "assistant",
        },
      ]);
      setIsLoading(false);
      throw new Error("Failed to fetch chat completion");
    }

    const reader = response.events.getReader();

    // Whether to feed back the new messages to GPT
    let feedback = false;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        let currentMessage = Object.assign({}, newMessages[newMessages.length - 1]);

        if (value.type === "content") {
          if (currentMessage.function_call || currentMessage.role === "function") {
            // Create a new message if the previous one is a function call or result
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
        } else if (value.type === "result") {
          // When we get a result message, it is already complete
          currentMessage = {
            id: nanoid(),
            role: "function",
            content: value.content,
            name: value.name,
          };
          newMessages.push(currentMessage);
          setMessages([...messages, ...newMessages]);

          // After receiving a result, feed back the new messages to GPT
          feedback = true;
        } else if (value.type === "function" || value.type === "partial") {
          // Create a new message if the previous one is not empty
          if (
            currentMessage.content != "" ||
            currentMessage.function_call ||
            currentMessage.role == "function"
          ) {
            currentMessage = {
              id: nanoid(),
              createdAt: new Date(),
              content: "",
              role: "assistant",
            };
            newMessages.push(currentMessage);
          }
          if (value.type === "function") {
            currentMessage.function_call = {
              name: value.name,
              arguments: JSON.stringify(value.arguments),
              scope: value.scope,
            };
          } else if (value.type === "partial") {
            let partialArguments: any = {};
            try {
              partialArguments = JSON.parse(untruncateJson(value.arguments));
            } catch (e) {}

            currentMessage.partialFunctionCall = {
              name: value.name,
              arguments: partialArguments,
            };
          }

          newMessages[newMessages.length - 1] = currentMessage;
          setMessages([...messages, ...newMessages]);

          if (value.type === "function") {
            // Execute the function call
            try {
              if (options.onFunctionCall && value.scope === "client") {
                const result = await options.onFunctionCall(
                  messages,
                  currentMessage.function_call as FunctionCall,
                );

                currentMessage = {
                  id: nanoid(),
                  role: "function",
                  content: encodeResult(result),
                  name: (currentMessage.function_call! as FunctionCall).name!,
                };
                newMessages.push(currentMessage);
                setMessages([...messages, ...newMessages]);

                // After a function call, feed back the new messages to GPT
                feedback = true;
              }
            } catch (error) {
              console.error("Failed to execute function call", error);
              // TODO: Handle error
              // this should go to the message itself
            }
          }
        }
      }

      // If we want feedback, run the completion again and return the results
      if (feedback) {
        return await runChatCompletion([...messages, ...newMessages]);
      }
      // otherwise, return the new messages
      else {
        return newMessages.slice();
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
    append,
    reload,
    stop,
    isLoading,
    input,
    setInput,
  };
}
