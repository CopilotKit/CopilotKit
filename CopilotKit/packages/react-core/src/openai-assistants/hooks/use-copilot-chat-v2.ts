"use client";

import { useContext, useState } from "react";
import { processMessageStream } from "../utils";
import { Message, parseStreamPart } from "@copilotkit/shared";
import { CopilotContext, copilotApiConfigExtrapolator } from "../../context";

export type AssistantStatus = "in_progress" | "awaiting_message";

export interface RequestForwardingOptions {
  /**
   * The credentials mode to be used for the fetch request.
   * Possible values are: 'omit', 'same-origin', 'include'.
   * Defaults to 'same-origin'.
   */
  credentials?: RequestCredentials;
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
}
export interface USeCopilotChatOptionsV2 extends RequestForwardingOptions {
  makeSystemMessage?: (contextString: string) => string;
  threadId?: string | undefined;
}

export interface UseCopilotChatV2Result {
  messages: Message[];
  input: string;
  handleInputChange: (e: any) => void;
  submitMessage: (e: any) => Promise<void>;
  status: AssistantStatus;
  error: unknown;
}

export function useCopilotChatV2(
  options: USeCopilotChatOptionsV2
): UseCopilotChatV2Result {
  const {
    getContextString,
    getChatCompletionFunctionDescriptions,
    getFunctionCallHandler,
    copilotApiConfig,
  } = useContext(CopilotContext);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<AssistantStatus>("awaiting_message");
  const [error, setError] = useState<unknown | undefined>(undefined);

  const handleInputChange = (e: any) => {
    setInput(e.target.value);
  };

  const submitMessage = async (e: any) => {
    e.preventDefault();

    if (input === "") {
      return;
    }

    setStatus("in_progress");

    setMessages((messages) => [
      ...messages,
      { id: "", role: "user", content: input },
    ]);

    setInput("");

    const result = await fetch(
      copilotApiConfigExtrapolator(copilotApiConfig).chatApiEndpointV2,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...copilotApiConfig.headers,
          ...options.headers,
        },
        body: JSON.stringify({
          // always use user-provided threadId when available:
          threadId: options.threadId ?? threadId ?? null,
          message: input,
          functions: getChatCompletionFunctionDescriptions(),
          ...copilotApiConfig.body,
          ...options.body,
        }),
      }
    );

    if (result.body == null) {
      throw new Error("The response body is empty.");
    }

    await processMessageStream(result.body.getReader(), (message: string) => {
      try {
        const { type, value } = parseStreamPart(message);

        switch (type) {
          case "assistant_message": {
            // append message:
            setMessages((messages) => [
              ...messages,
              {
                id: value.id,
                role: value.role,
                content: value.content[0].text.value,
              },
            ]);
            break;
          }

          case "assistant_control_data": {
            setThreadId(value.threadId);

            // set id of last message:
            setMessages((messages) => {
              const lastMessage = messages[messages.length - 1];
              lastMessage.id = value.messageId;
              return [...messages.slice(0, messages.length - 1), lastMessage];
            });

            break;
          }

          case "error": {
            setError(value);
            break;
          }
        }
      } catch (error) {
        setError(error);
      }
    });

    setStatus("awaiting_message");
  };

  return {
    messages,
    input,
    handleInputChange,
    submitMessage,
    status,
    error,
  };
}
