import { useRef } from "react";
import {
  FunctionCallHandler,
  COPILOT_CLOUD_PUBLIC_API_KEY_HEADER,
  Action,
  actionParametersToJsonSchema,
} from "@copilotkit/shared";
import {
  Message,
  TextMessage,
  ActionExecutionMessage,
  ResultMessage,
  CopilotRuntimeClient,
  convertMessagesToGqlInput,
  convertGqlOutputToMessages,
  MessageStatusCode,
} from "@copilotkit/runtime-client-gql";

import { CopilotApiConfig } from "../context";
import { plainToInstance } from "class-transformer";

export type UseChatOptions = {
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
   * Function definitions to be sent to the API.
   */
  actions: Action[];

  /**
   * The CopilotKit API configuration.
   */
  copilotConfig: CopilotApiConfig;

  /**
   * The current list of messages in the chat.
   */
  messages: Message[];
  /**
   * The setState-powered method to update the chat messages.
   */
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;

  /**
   * A callback to get the latest system message.
   */
  makeSystemMessageCallback: () => TextMessage;

  /**
   * Whether the API request is in progress
   */
  isLoading: boolean;

  /**
   * setState-powered method to update the isChatLoading value
   */
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
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
};

export function useChat(options: UseChatOptions): UseChatHelpers {
  const {
    messages,
    setMessages,
    makeSystemMessageCallback,
    copilotConfig,
    setIsLoading,
    initialMessages,
    isLoading,
    actions,
    onFunctionCall,
  } = options;
  const abortControllerRef = useRef<AbortController>();
  const threadIdRef = useRef<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const publicApiKey = copilotConfig.publicApiKey;
  const headers = {
    ...(copilotConfig.headers || {}),
    ...(publicApiKey ? { [COPILOT_CLOUD_PUBLIC_API_KEY_HEADER]: publicApiKey } : {}),
  };

  const runtimeClient = new CopilotRuntimeClient({
    url: copilotConfig.chatApiEndpoint,
  });

  const runChatCompletion = async (previousMessages: Message[]): Promise<Message[]> => {
    setIsLoading(true);

    // this message is just a placeholder. It will disappear once the first real message
    // is received
    let newMessages: Message[] = [
      plainToInstance(TextMessage, {
        id: "--PLACEHOLDER-MESSAGE-ID--",
        createdAt: new Date(),
        content: "",
        role: "assistant",
        status: {
          code: MessageStatusCode.Success,
        },
      }),
    ];

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setMessages([...previousMessages, ...newMessages]);

    const systemMessage = makeSystemMessageCallback();

    const messagesWithContext = [systemMessage, ...(initialMessages || []), ...previousMessages];

    const stream = CopilotRuntimeClient.asStream(
      runtimeClient.generateResponse({
        frontend: {
          actions: actions.map((action) => ({
            name: action.name,
            description: action.description || "",
            jsonSchema: JSON.stringify(actionParametersToJsonSchema(action.parameters || [])),
          })),
        },
        threadId: threadIdRef.current,
        runId: runIdRef.current,
        messages: convertMessagesToGqlInput(messagesWithContext),
      }),
    );

    // TODO-PROTOCOL make sure all options are included in the final version
    //
    // const response = await fetchAndDecodeChatCompletion({
    //   copilotConfig: { ...options.copilotConfig, body: copilotConfigBody },
    //   messages: messagesWithContext,
    //   tools: options.tools,
    //   headers: headers,
    //   signal: abortController.signal,
    // });

    // TODO-PROTOCOL handle errors
    // if (!response.events) {
    //   setMessages([
    //     ...messages,
    //     {
    //       id: nanoid(),
    //       createdAt: new Date(),
    //       content: response.statusText,
    //       role: "assistant",
    //     },
    //   ]);
    //   options.setIsLoading(false);
    //   throw new Error("Failed to fetch chat completion");
    // }

    const reader = stream.getReader();

    let results: { [id: string]: string } = {};

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        if (!value.generateResponse) {
          continue;
        }

        threadIdRef.current = value.generateResponse.threadId || null;
        runIdRef.current = value.generateResponse.runId || null;

        const messages = convertGqlOutputToMessages(value.generateResponse.messages);

        if (messages.length === 0) {
          continue;
        }

        newMessages = [];

        for (const message of messages) {
          newMessages.push(message);

          if (
            message instanceof ActionExecutionMessage &&
            message.status.code !== MessageStatusCode.Pending &&
            message.scope === "client" &&
            onFunctionCall
          ) {
            if (!(message.id in results)) {
              // execute action
              const result = await onFunctionCall({
                messages: previousMessages,
                name: message.name,
                args: message.arguments,
              });
              results[message.id] = result;
            }

            // add the result message
            newMessages.push(
              plainToInstance(ResultMessage, {
                id: message.id + "-result",
                result: ResultMessage.encodeResult(results[message.id]),
                actionExecutionId: message.id,
                actionName: message.name,
                createdAt: new Date(),
                status: {
                  code: MessageStatusCode.Success,
                },
              }),
            );
          }
        }

        if (newMessages.length > 0) {
          setMessages([...previousMessages, ...newMessages]);
        }
      }

      if (
        // if we have client side results
        Object.values(results).length ||
        // or the last message we received is a result
        (newMessages.length && newMessages[newMessages.length - 1] instanceof ResultMessage)
      ) {
        // run the completion again and return the result

        // wait for next tick to make sure all the react state updates
        // - tried using react-dom's flushSync, but it did not work
        await new Promise((resolve) => setTimeout(resolve, 10));

        return await runChatCompletion([...previousMessages, ...newMessages]);
      } else {
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

    if (lastMessage instanceof TextMessage && lastMessage.role === "assistant") {
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
  };
}
