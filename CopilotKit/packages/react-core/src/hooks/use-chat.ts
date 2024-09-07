import { useRef } from "react";
import {
  FunctionCallHandler,
  COPILOT_CLOUD_PUBLIC_API_KEY_HEADER,
  actionParametersToJsonSchema,
  CoagentActionHandler,
} from "@copilotkit-alt/shared";
import {
  Message,
  TextMessage,
  ActionExecutionMessage,
  ResultMessage,
  CopilotRuntimeClient,
  convertMessagesToGqlInput,
  convertGqlOutputToMessages,
  MessageStatusCode,
  MessageRole,
  Role,
  CopilotRequestType,
  AgentStateMessage,
} from "@copilotkit-alt/runtime-client-gql";

import { CopilotApiConfig } from "../context";
import { FrontendAction } from "../types/frontend-action";
import { CoagentState } from "../types/coagent-state";
import { AgentSession } from "../context/copilot-context";

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
   * Callback function to be called when a coagent action is received.
   */
  onCoagentAction?: CoagentActionHandler;

  /**
   * Function definitions to be sent to the API.
   */
  actions: FrontendAction<any>[];

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

  /**
   * The current list of coagent states.
   */
  coagentStates: Record<string, CoagentState>;

  /**
   * setState-powered method to update the agent states
   */
  setCoagentStates: React.Dispatch<React.SetStateAction<Record<string, CoagentState>>>;

  /**
   * The current agent session.
   */
  agentSession: AgentSession | null;

  /**
   * setState-powered method to update the agent session
   */
  setAgentSession: React.Dispatch<React.SetStateAction<AgentSession | null>>;
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
    onCoagentAction,
    setCoagentStates,
    coagentStates,
    agentSession,
    setAgentSession,
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
    publicApiKey: copilotConfig.publicApiKey,
    headers,
    credentials: copilotConfig.credentials,
  });

  const runChatCompletion = async (previousMessages: Message[]): Promise<Message[]> => {
    setIsLoading(true);

    // this message is just a placeholder. It will disappear once the first real message
    // is received
    let newMessages: Message[] = [
      new TextMessage({
        content: "",
        role: Role.Assistant,
      }),
    ];
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setMessages([...previousMessages, ...newMessages]);

    const systemMessage = makeSystemMessageCallback();

    const messagesWithContext = [systemMessage, ...(initialMessages || []), ...previousMessages];

    const stream = CopilotRuntimeClient.asStream(
      runtimeClient.generateCopilotResponse({
        data: {
          frontend: {
            actions: actions.map((action) => ({
              name: action.name,
              description: action.description || "",
              jsonSchema: JSON.stringify(actionParametersToJsonSchema(action.parameters || [])),
            })),
            url: window.location.href,
          },
          threadId: threadIdRef.current,
          runId: runIdRef.current,
          messages: convertMessagesToGqlInput(messagesWithContext),
          ...(copilotConfig.cloud
            ? {
                cloud: {
                  ...(copilotConfig.cloud.guardrails?.input?.restrictToTopic?.enabled
                    ? {
                        guardrails: {
                          inputValidationRules: {
                            allowList:
                              copilotConfig.cloud.guardrails.input.restrictToTopic.validTopics,
                            denyList:
                              copilotConfig.cloud.guardrails.input.restrictToTopic.invalidTopics,
                          },
                        },
                      }
                    : {}),
                },
              }
            : {}),
          metadata: {
            requestType: CopilotRequestType.Chat,
          },
          ...(agentSession
            ? {
                agentSession,
              }
            : {}),
          agentStates: Object.values(coagentStates).map((state) => ({
            agentName: state.name,
            state: JSON.stringify(state.state),
          })),
        },
        properties: copilotConfig.properties,
        signal: abortControllerRef.current?.signal,
      }),
    );

    const guardrailsEnabled =
      copilotConfig.cloud?.guardrails?.input?.restrictToTopic.enabled || false;

    const reader = stream.getReader();

    let actionResults: { [id: string]: string } = {};
    let executedCoagentActions: string[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        if (!value?.generateCopilotResponse) {
          continue;
        }

        threadIdRef.current = value.generateCopilotResponse.threadId || null;
        runIdRef.current = value.generateCopilotResponse.runId || null;

        const messages = convertGqlOutputToMessages(value.generateCopilotResponse.messages);

        if (messages.length === 0) {
          continue;
        }

        newMessages = [];

        // request failed, display error message
        if (
          value.generateCopilotResponse.status?.__typename === "FailedResponseStatus" &&
          value.generateCopilotResponse.status.reason === "GUARDRAILS_VALIDATION_FAILED"
        ) {
          newMessages = [
            new TextMessage({
              role: MessageRole.Assistant,
              content: value.generateCopilotResponse.status.details?.guardrailsReason || "",
            }),
          ];
        }

        // add messages to the chat
        else {
          for (const message of messages) {
            newMessages.push(message);

            if (message instanceof AgentStateMessage) {
              if (message.running) {
                setCoagentStates((prevAgentStates) => ({
                  ...prevAgentStates,
                  [message.agentName]: {
                    name: message.agentName,
                    state: message.state,
                    running: message.running,
                    active: message.active,
                    threadId: message.threadId,
                    nodeName: message.nodeName,
                    runId: message.runId,
                  },
                }));
                setAgentSession({
                  threadId: message.threadId,
                  agentName: message.agentName,
                  nodeName: message.nodeName,
                });
              } else {
                setAgentSession(null);
              }
            }

            // execute regular action executions
            if (
              message instanceof ActionExecutionMessage &&
              message.status.code !== MessageStatusCode.Pending &&
              message.scope === "client" &&
              onFunctionCall
            ) {
              if (!(message.id in actionResults)) {
                // Do not execute a function call if guardrails are enabled but the status is not known
                if (guardrailsEnabled && value.generateCopilotResponse.status === undefined) {
                  break;
                }
                // execute action
                const result = await onFunctionCall({
                  messages: previousMessages,
                  name: message.name,
                  args: message.arguments,
                });
                actionResults[message.id] = result;
              }

              // add the result message
              newMessages.push(
                new ResultMessage({
                  result: ResultMessage.encodeResult(actionResults[message.id]),
                  actionExecutionId: message.id,
                  actionName: message.name,
                }),
              );
            }

            // execute coagent actions
            if (
              message instanceof AgentStateMessage &&
              !message.active &&
              !executedCoagentActions.includes(message.id) &&
              onCoagentAction
            ) {
              // Do not execute a coagent action if guardrails are enabled but the status is not known
              if (guardrailsEnabled && value.generateCopilotResponse.status === undefined) {
                break;
              }
              // execute coagent action
              await onCoagentAction({
                name: message.agentName,
                nodeName: message.nodeName,
                state: message.state,
              });
              executedCoagentActions.push(message.id);
            }
          }
        }

        if (newMessages.length > 0) {
          // Construct filteredMessages inline to remove adjacent AgentStateMessage instances
          // with the same agentName, keeping only the last one.
          const filteredMessages = [...previousMessages, ...newMessages].reduce(
            (acc: Message[], message: Message) => {
              if (
                // If the current message is an AgentStateMessage
                message instanceof AgentStateMessage &&
                // And there is at least one message in the accumulator
                acc.length > 0 &&
                // And the last message in the accumulator is also an AgentStateMessage
                acc[acc.length - 1] instanceof AgentStateMessage &&
                // And the agentName, nodeName, and runId are the same
                (acc[acc.length - 1] as AgentStateMessage).agentName === message.agentName &&
                (acc[acc.length - 1] as AgentStateMessage).nodeName === message.nodeName &&
                (acc[acc.length - 1] as AgentStateMessage).runId === message.runId
              ) {
                // If the conditions are met, replace the last message in the accumulator with the current message
                acc[acc.length - 1] = message;
              } else {
                // Otherwise, add the current message to the accumulator
                acc.push(message);
              }
              return acc;
            },
            [],
          );

          // Update the state with the filtered messages
          setMessages(filteredMessages);
        }
      }

      if (
        // if we have client side results
        Object.values(actionResults).length ||
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
