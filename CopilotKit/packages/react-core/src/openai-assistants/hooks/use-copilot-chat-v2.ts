import { useContext, useMemo, useState } from "react";
import { processMessageStream } from "../utils";
import { Message, parseStreamPart } from "@copilotkit/shared";
import { CopilotContext } from "../../context";
import { defaultCopilotContextCategories } from "../../components";

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
export interface UseCopilotChatOptionsV2 extends RequestForwardingOptions {
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

export function useCopilotChatV2(options: UseCopilotChatOptionsV2): UseCopilotChatV2Result {
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

  const systemMessage: Message = useMemo(() => {
    const systemMessageMaker = options.makeSystemMessage || defaultSystemMessage;
    const contextString = getContextString([], defaultCopilotContextCategories); // TODO: make the context categories configurable

    return {
      id: "system",
      content: systemMessageMaker(contextString),
      role: "system",
    };
  }, [getContextString, options.makeSystemMessage]);

  const handleInputChange = (e: any) => {
    setInput(e.target.value);
  };

  const submitMessage = async (e: any) => {
    e.preventDefault();

    if (input === "") {
      return;
    }

    setStatus("in_progress");

    setMessages((messages) => [...messages, { id: "", role: "user", content: input }]);

    setInput("");

    const apiUrl = copilotApiConfig.chatApiEndpointV2;

    const functions = getChatCompletionFunctionDescriptions();

    const result = await fetch(apiUrl, {
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
        ...(functions.length > 0 && { functions: functions }),
        ...copilotApiConfig.body,
        ...options.body,
      }),
    });

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

export function defaultSystemMessage(contextString: string): string {
  return `
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
`;
}
