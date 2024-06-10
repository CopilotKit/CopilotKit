import { useRef, useState, useContext, useEffect } from "react";
import { CopilotContext } from "../context/copilot-context";
import {
  Message,
  ToolDefinition,
  FunctionCallHandler,
  encodeResult,
  FunctionCall,
  COPILOT_CLOUD_PUBLIC_API_KEY_HEADER,
  Role,
  Action,
  actionParametersToJsonSchema,
} from "@copilotkit/shared";

import { nanoid } from "nanoid";
import { fetchAndDecodeChatCompletion } from "../utils/fetch-chat-completion";
import { CopilotApiConfig } from "../context";
import untruncateJson from "untruncate-json";
import { CopilotRuntimeClient, MessageInput, MessageRole } from "@copilotkit/runtime-client-gql";

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
  makeSystemMessageCallback: () => Message;

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

  const runChatCompletion = async (messages: Message[]): Promise<Message[]> => {
    setIsLoading(true);

    let newMessages: Message[] = [
      {
        id: "--PLACEHOLDER-MESSAGE-ID--",
        createdAt: new Date(),
        content: "",
        role: "assistant",
      },
    ];

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setMessages([...messages, ...newMessages]);

    const systemMessage = makeSystemMessageCallback();

    const messagesWithContext = [systemMessage, ...(initialMessages || []), ...messages];

    const response = runtimeClient.generateResponse({
      frontend: {
        actions: actions.map((action) => ({
          name: action.name,
          description: action.description || "",
          jsonSchema: JSON.stringify(actionParametersToJsonSchema(action.parameters || [])),
        })),
      },
      threadId: threadIdRef.current,
      runId: runIdRef.current,
      messages: messagesWithContext.map(({ content, role }) => ({
        content,
        role: role as MessageRole,
      })),
    });

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

    const reader = CopilotRuntimeClient.asStream(response).getReader();

    // Whether to feed back the new messages to GPT
    let feedback = false;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        threadIdRef.current = value.generateResponse.threadId || null;
        runIdRef.current = value.generateResponse.runId || null;

        newMessages = value.generateResponse.messages.map((message) => ({
          ...message,
          content: message.content.join(""),
        }));

        if (newMessages.length > 0) {
          setMessages([...messages, ...newMessages]);
        }

        // TODO-PROTOCOL: deal with all this, possibly in a more elegant manner
        //
        // let currentMessage = Object.assign({}, newMessages[newMessages.length - 1]);

        // if (value.type === "content") {
        //   if (currentMessage.function_call || currentMessage.role === "function") {
        //     // Create a new message if the previous one is a function call or result
        //     currentMessage = {
        //       id: nanoid(),
        //       createdAt: new Date(),
        //       content: "",
        //       role: "assistant",
        //     };
        //     newMessages.push(currentMessage);
        //   }
        //   currentMessage.content += value.content;
        //   newMessages[newMessages.length - 1] = currentMessage;
        //   setMessages([...messages, ...newMessages]);
        // } else if (value.type === "result") {
        //   // When we get a result message, it is already complete
        //   currentMessage = {
        //     id: nanoid(),
        //     role: "function",
        //     content: value.content,
        //     name: value.name,
        //   };
        //   newMessages.push(currentMessage);
        //   setMessages([...messages, ...newMessages]);

        //   // After receiving a result, feed back the new messages to GPT
        //   feedback = true;
        // } else if (value.type === "function" || value.type === "partial") {
        //   // Create a new message if the previous one is not empty
        //   if (
        //     currentMessage.content != "" ||
        //     currentMessage.function_call ||
        //     currentMessage.role == "function"
        //   ) {
        //     currentMessage = {
        //       id: nanoid(),
        //       createdAt: new Date(),
        //       content: "",
        //       role: "assistant",
        //     };
        //     newMessages.push(currentMessage);
        //   }
        //   if (value.type === "function") {
        //     currentMessage.function_call = {
        //       name: value.name,
        //       arguments: JSON.stringify(value.arguments),
        //       scope: value.scope,
        //     };
        //   } else if (value.type === "partial") {
        //     let partialArguments: any = {};
        //     try {
        //       partialArguments = JSON.parse(untruncateJson(value.arguments));
        //     } catch (e) {}

        //     currentMessage.partialFunctionCall = {
        //       name: value.name,
        //       arguments: partialArguments,
        //     };
        //   }

        //   newMessages[newMessages.length - 1] = currentMessage;
        //   setMessages([...messages, ...newMessages]);

        //   if (value.type === "function") {
        //     // Execute the function call
        //     try {
        //       if (options.onFunctionCall && value.scope === "client") {
        //         const result = await options.onFunctionCall(
        //           messages,
        //           currentMessage.function_call as FunctionCall,
        //         );

        //         currentMessage = {
        //           id: nanoid(),
        //           role: "function",
        //           content: encodeResult(result),
        //           name: (currentMessage.function_call! as FunctionCall).name!,
        //         };
        //         newMessages.push(currentMessage);
        //         setMessages([...messages, ...newMessages]);

        //         // After a function call, feed back the new messages to GPT
        //         feedback = true;
        //       }
        //     } catch (error) {
        //       console.error("Failed to execute function call", error);
        //       // TODO: Handle error
        //       // this should go to the message itself
        //     }
        //   }
        // }
      }

      // If we want feedback, run the completion again and return the results
      if (feedback) {
        // wait for next tick to make sure all the react state updates
        // TODO: This is a hack, is there a more robust way to do this?
        // - tried using react-dom's flushSync, but it did not work
        await new Promise((resolve) => setTimeout(resolve, 10));

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
  };
}
