import React, { useCallback, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import {
  FunctionCallHandler,
  COPILOT_CLOUD_PUBLIC_API_KEY_HEADER,
  CoAgentStateRenderHandler,
  randomId,
  parseJson,
  CopilotKitError,
  CopilotKitErrorCode,
} from "@copilotkit/shared";
import {
  Message,
  TextMessage,
  ResultMessage,
  convertMessagesToGqlInput,
  filterAdjacentAgentStateMessages,
  filterAgentStateMessages,
  convertGqlOutputToMessages,
  MessageStatusCode,
  MessageRole,
  Role,
  CopilotRequestType,
  ForwardedParametersInput,
  loadMessagesFromJsonRepresentation,
  ExtensionsInput,
  CopilotRuntimeClient,
  langGraphInterruptEvent,
  MetaEvent,
  MetaEventName,
  ActionExecutionMessage,
  CopilotKitLangGraphInterruptEvent,
  LangGraphInterruptEvent,
  MetaEventInput,
  AgentStateInput,
} from "@copilotkit/runtime-client-gql";

import { CopilotApiConfig } from "../context";
import { FrontendAction, processActionsForRuntimeRequest } from "../types/frontend-action";
import { CoagentState } from "../types/coagent-state";
import { AgentSession, useCopilotContext } from "../context/copilot-context";
import { useCopilotRuntimeClient } from "./use-copilot-runtime-client";
import { useAsyncCallback, useErrorToast } from "../components/error-boundary/error-utils";
import { useToast } from "../components/toast/toast-provider";
import {
  LangGraphInterruptAction,
  LangGraphInterruptActionSetter,
} from "../types/interrupt-action";

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
  onCoAgentStateRender?: CoAgentStateRenderHandler;

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
  coagentStatesRef: React.RefObject<Record<string, CoagentState>>;

  /**
   * setState-powered method to update the agent states
   */
  setCoagentStatesWithRef: React.Dispatch<React.SetStateAction<Record<string, CoagentState>>>;

  /**
   * The current agent session.
   */
  agentSession: AgentSession | null;

  /**
   * setState-powered method to update the agent session
   */
  setAgentSession: React.Dispatch<React.SetStateAction<AgentSession | null>>;

  /**
   * The forwarded parameters.
   */
  forwardedParameters?: Pick<ForwardedParametersInput, "temperature">;

  /**
   * The current thread ID.
   */
  threadId: string;
  /**
   * set the current thread ID
   */
  setThreadId: (threadId: string) => void;
  /**
   * The current run ID.
   */
  runId: string | null;
  /**
   * set the current run ID
   */
  setRunId: (runId: string | null) => void;
  /**
   * The global chat abort controller.
   */
  chatAbortControllerRef: React.MutableRefObject<AbortController | null>;
  /**
   * The agent lock.
   */
  agentLock: string | null;
  /**
   * The extensions.
   */
  extensions: ExtensionsInput;
  /**
   * The setState-powered method to update the extensions.
   */
  setExtensions: React.Dispatch<React.SetStateAction<ExtensionsInput>>;

  langGraphInterruptAction: LangGraphInterruptAction | null;

  setLangGraphInterruptAction: LangGraphInterruptActionSetter;

  disableSystemMessage?: boolean;
};

export type UseChatHelpers = {
  /**
   * Append a user message to the chat list. This triggers the API call to fetch
   * the assistant's response.
   * @param message The message to append
   */
  append: (message: Message, options?: AppendMessageOptions) => Promise<void>;
  /**
   * Reload the last AI chat response for the given chat history. If the last
   * message isn't from the assistant, it will request the API to generate a
   * new response.
   */
  reload: (messageId: string) => Promise<void>;
  /**
   * Abort the current request immediately, keep the generated tokens if any.
   */
  stop: () => void;

  /**
   * Run the chat completion.
   */
  runChatCompletion: () => Promise<Message[]>;
};

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
    onCoAgentStateRender,
    setCoagentStatesWithRef,
    coagentStatesRef,
    agentSession,
    setAgentSession,
    threadId,
    setThreadId,
    runId,
    setRunId,
    chatAbortControllerRef,
    agentLock,
    extensions,
    setExtensions,
    langGraphInterruptAction,
    setLangGraphInterruptAction,
    disableSystemMessage = false,
  } = options;
  const runChatCompletionRef = useRef<(previousMessages: Message[]) => Promise<Message[]>>();
  const addErrorToast = useErrorToast();
  const { setBannerError } = useToast();

  // Get onError from context since it's not part of copilotConfig
  const { onError } = useCopilotContext();

  // Add tracing functionality to use-chat
  const traceUIError = async (error: CopilotKitError, originalError?: any) => {
    // Just check if onError and publicApiKey are defined
    if (!onError || !copilotConfig?.publicApiKey) return;

    try {
      const traceEvent = {
        type: "error" as const,
        timestamp: Date.now(),
        context: {
          source: "ui" as const,
          request: {
            operation: "useChatCompletion",
            url: copilotConfig.chatApiEndpoint,
            startTime: Date.now(),
          },
          technical: {
            environment: "browser",
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
            stackTrace: originalError instanceof Error ? originalError.stack : undefined,
          },
        },
        error,
      };

      await onError(traceEvent);
    } catch (traceError) {
      console.error("Error in use-chat onError handler:", traceError);
    }
  };
  // We need to keep a ref of coagent states and session because of renderAndWait - making sure
  // the latest state is sent to the API
  // This is a workaround and needs to be addressed in the future
  const agentSessionRef = useRef<AgentSession | null>(agentSession);
  agentSessionRef.current = agentSession;

  const runIdRef = useRef<string | null>(runId);
  runIdRef.current = runId;
  const extensionsRef = useRef<ExtensionsInput>(extensions);
  extensionsRef.current = extensions;

  const publicApiKey = copilotConfig.publicApiKey;

  const headers = {
    ...(copilotConfig.headers || {}),
    ...(publicApiKey ? { [COPILOT_CLOUD_PUBLIC_API_KEY_HEADER]: publicApiKey } : {}),
  };

  const { showDevConsole } = useCopilotContext();

  const runtimeClient = useCopilotRuntimeClient({
    url: copilotConfig.chatApiEndpoint,
    publicApiKey: copilotConfig.publicApiKey,
    headers,
    credentials: copilotConfig.credentials,
    showDevConsole,
  });

  const pendingAppendsRef = useRef<{ message: Message; followUp: boolean }[]>([]);

  const runChatCompletion = useAsyncCallback(
    async (previousMessages: Message[]): Promise<Message[]> => {
      setIsLoading(true);
      const interruptEvent = langGraphInterruptAction?.event;
      // In case an interrupt event exist and valid but has no response yet, we cannot process further messages to an agent
      if (
        interruptEvent?.name === MetaEventName.LangGraphInterruptEvent &&
        interruptEvent?.value &&
        !interruptEvent?.response &&
        agentSessionRef.current
      ) {
        addErrorToast([
          new Error(
            "A message was sent while interrupt is active. This will cause failure on the agent side",
          ),
        ]);
      }

      // this message is just a placeholder. It will disappear once the first real message
      // is received
      let newMessages: Message[] = [
        new TextMessage({
          content: "",
          role: Role.Assistant,
        }),
      ];

      chatAbortControllerRef.current = new AbortController();

      setMessages([...previousMessages, ...newMessages]);

      const messagesWithContext = disableSystemMessage
        ? [...(initialMessages || []), ...previousMessages]
        : [makeSystemMessageCallback(), ...(initialMessages || []), ...previousMessages];

      // ----- Set mcpServers in properties -----
      // Create a copy of properties to avoid modifying the original object
      const finalProperties = { ...(copilotConfig.properties || {}) };

      // Look for mcpServers in either direct property or properties
      let mcpServersToUse = null;

      // First check direct mcpServers property
      if (
        copilotConfig.mcpServers &&
        Array.isArray(copilotConfig.mcpServers) &&
        copilotConfig.mcpServers.length > 0
      ) {
        mcpServersToUse = copilotConfig.mcpServers;
      }
      // Then check mcpServers in properties
      else if (
        copilotConfig.properties?.mcpServers &&
        Array.isArray(copilotConfig.properties.mcpServers) &&
        copilotConfig.properties.mcpServers.length > 0
      ) {
        mcpServersToUse = copilotConfig.properties.mcpServers;
      }

      // Apply the mcpServers to properties if found
      if (mcpServersToUse) {
        // Set in finalProperties
        finalProperties.mcpServers = mcpServersToUse;

        // Also set in copilotConfig directly for future use
        copilotConfig.mcpServers = mcpServersToUse;
      }
      // -------------------------------------------------------------

      const isAgentRun = agentSessionRef.current !== null;

      const stream = runtimeClient.asStream(
        runtimeClient.generateCopilotResponse({
          data: {
            frontend: {
              actions: processActionsForRuntimeRequest(actions),
              url: window.location.href,
            },
            threadId: threadId,
            runId: runIdRef.current,
            extensions: extensionsRef.current,
            metaEvents: composeAndFlushMetaEventsInput([langGraphInterruptAction?.event]),
            messages: convertMessagesToGqlInput(filterAgentStateMessages(messagesWithContext)),
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
            ...(agentSessionRef.current
              ? {
                  agentSession: agentSessionRef.current,
                }
              : {}),
            agentStates: Object.values(coagentStatesRef.current!).map((state) => {
              const stateObject: AgentStateInput = {
                agentName: state.name,
                state: JSON.stringify(state.state),
              };

              if (state.config !== undefined) {
                stateObject.config = JSON.stringify(state.config);
              }

              return stateObject;
            }),
            forwardedParameters: options.forwardedParameters || {},
          },
          properties: finalProperties,
          signal: chatAbortControllerRef.current?.signal,
        }),
      );

      const guardrailsEnabled =
        copilotConfig.cloud?.guardrails?.input?.restrictToTopic.enabled || false;

      const reader = stream.getReader();

      let executedCoAgentStateRenders: string[] = [];
      let followUp: FrontendAction["followUp"] = undefined;

      let messages: Message[] = [];
      let syncedMessages: Message[] = [];
      let interruptMessages: Message[] = [];

      try {
        while (true) {
          let done, value;

          try {
            const readResult = await reader.read();
            done = readResult.done;
            value = readResult.value;
          } catch (readError) {
            break;
          }

          if (done) {
            if (chatAbortControllerRef.current.signal.aborted) {
              return [];
            }
            break;
          }

          if (!value?.generateCopilotResponse) {
            continue;
          }

          runIdRef.current = value.generateCopilotResponse.runId || null;

          // in the output, graphql inserts __typename, which leads to an error when sending it along
          // as input to the next request.
          extensionsRef.current = CopilotRuntimeClient.removeGraphQLTypename(
            value.generateCopilotResponse.extensions || {},
          );

          // setThreadId(threadIdRef.current);
          setRunId(runIdRef.current);
          setExtensions(extensionsRef.current);
          let rawMessagesResponse = value.generateCopilotResponse.messages;

          const metaEvents: MetaEvent[] | undefined =
            value.generateCopilotResponse?.metaEvents ?? [];
          (metaEvents ?? []).forEach((ev) => {
            if (ev.name === MetaEventName.LangGraphInterruptEvent) {
              let eventValue = langGraphInterruptEvent(ev as LangGraphInterruptEvent).value;
              eventValue = parseJson(eventValue, eventValue);
              setLangGraphInterruptAction({
                event: {
                  ...langGraphInterruptEvent(ev as LangGraphInterruptEvent),
                  value: eventValue,
                },
              });
            }
            if (ev.name === MetaEventName.CopilotKitLangGraphInterruptEvent) {
              const data = (ev as CopilotKitLangGraphInterruptEvent).data;

              // @ts-expect-error -- same type of messages
              rawMessagesResponse = [...rawMessagesResponse, ...data.messages];
              interruptMessages = convertGqlOutputToMessages(
                // @ts-ignore
                filterAdjacentAgentStateMessages(data.messages),
              );
            }
          });

          messages = convertGqlOutputToMessages(
            filterAdjacentAgentStateMessages(rawMessagesResponse),
          );

          newMessages = [];

          // Handle error statuses BEFORE checking if there are messages
          // (errors can come in chunks with no messages)

          // request failed, display error message and quit
          if (
            value.generateCopilotResponse.status?.__typename === "FailedResponseStatus" &&
            value.generateCopilotResponse.status.reason === "GUARDRAILS_VALIDATION_FAILED"
          ) {
            const guardrailsReason =
              value.generateCopilotResponse.status.details?.guardrailsReason || "";

            newMessages = [
              new TextMessage({
                role: MessageRole.Assistant,
                content: guardrailsReason,
              }),
            ];

            // Trace guardrails validation failure
            const guardrailsError = new CopilotKitError({
              message: `Guardrails validation failed: ${guardrailsReason}`,
              code: CopilotKitErrorCode.MISUSE,
            });
            await traceUIError(guardrailsError, {
              statusReason: value.generateCopilotResponse.status.reason,
              statusDetails: value.generateCopilotResponse.status.details,
            });

            setMessages([...previousMessages, ...newMessages]);
            break;
          }

          // Handle UNKNOWN_ERROR failures (like authentication errors) by routing to banner error system
          if (
            value.generateCopilotResponse.status?.__typename === "FailedResponseStatus" &&
            value.generateCopilotResponse.status.reason === "UNKNOWN_ERROR"
          ) {
            const errorMessage =
              value.generateCopilotResponse.status.details?.description ||
              "An unknown error occurred";

            // Try to extract original error information from the response details
            const statusDetails = value.generateCopilotResponse.status.details;
            const originalError = statusDetails?.originalError || statusDetails?.error;

            // Extract structured error information if available (prioritize top-level over extensions)
            const originalCode = originalError?.code || originalError?.extensions?.code;
            const originalSeverity = originalError?.severity || originalError?.extensions?.severity;
            const originalVisibility =
              originalError?.visibility || originalError?.extensions?.visibility;

            // Use the original error code if available, otherwise default to NETWORK_ERROR
            let errorCode = CopilotKitErrorCode.NETWORK_ERROR;
            if (originalCode && Object.values(CopilotKitErrorCode).includes(originalCode)) {
              errorCode = originalCode;
            }

            // Create a structured CopilotKitError preserving original error information
            const structuredError = new CopilotKitError({
              message: errorMessage,
              code: errorCode,
              severity: originalSeverity,
              visibility: originalVisibility,
            });

            // Display the error in the banner
            setBannerError(structuredError);

            // Trace the error for debugging/observability
            await traceUIError(structuredError, {
              statusReason: value.generateCopilotResponse.status.reason,
              statusDetails: value.generateCopilotResponse.status.details,
              originalErrorCode: originalCode,
              preservedStructure: !!originalCode,
            });

            // Stop processing and break from the loop
            setIsLoading(false);
            break;
          }

          // add messages to the chat
          else if (messages.length > 0) {
            newMessages = [...messages];

            for (const message of messages) {
              // execute onCoAgentStateRender handler
              if (
                message.isAgentStateMessage() &&
                !message.active &&
                !executedCoAgentStateRenders.includes(message.id) &&
                onCoAgentStateRender
              ) {
                // Do not execute a coagent action if guardrails are enabled but the status is not known
                if (guardrailsEnabled && value.generateCopilotResponse.status === undefined) {
                  break;
                }
                // execute coagent action
                await onCoAgentStateRender({
                  name: message.agentName,
                  nodeName: message.nodeName,
                  state: message.state,
                });
                executedCoAgentStateRenders.push(message.id);
              }
            }

            const lastAgentStateMessage = [...messages]
              .reverse()
              .find((message) => message.isAgentStateMessage());

            if (lastAgentStateMessage) {
              if (
                lastAgentStateMessage.state.messages &&
                lastAgentStateMessage.state.messages.length > 0
              ) {
                syncedMessages = loadMessagesFromJsonRepresentation(
                  lastAgentStateMessage.state.messages,
                );
              }
              setCoagentStatesWithRef((prevAgentStates) => ({
                ...prevAgentStates,
                [lastAgentStateMessage.agentName]: {
                  name: lastAgentStateMessage.agentName,
                  state: lastAgentStateMessage.state,
                  running: lastAgentStateMessage.running,
                  active: lastAgentStateMessage.active,
                  threadId: lastAgentStateMessage.threadId,
                  nodeName: lastAgentStateMessage.nodeName,
                  runId: lastAgentStateMessage.runId,
                  // Preserve existing config from previous state
                  config: prevAgentStates[lastAgentStateMessage.agentName]?.config,
                },
              }));
              if (lastAgentStateMessage.running) {
                setAgentSession({
                  threadId: lastAgentStateMessage.threadId,
                  agentName: lastAgentStateMessage.agentName,
                  nodeName: lastAgentStateMessage.nodeName,
                });
              } else {
                if (agentLock) {
                  setAgentSession({
                    threadId: randomId(),
                    agentName: agentLock,
                    nodeName: undefined,
                  });
                } else {
                  setAgentSession(null);
                }
              }
            }
          }

          if (newMessages.length > 0) {
            // Update message state
            setMessages([...previousMessages, ...newMessages]);
          }
        }
        let finalMessages = constructFinalMessages(
          [...syncedMessages, ...interruptMessages],
          previousMessages,
          newMessages,
        );

        let didExecuteAction = false;

        // ----- Helper function to execute an action and manage its lifecycle -----
        const executeActionFromMessage = async (
          currentAction: FrontendAction<any>,
          actionMessage: ActionExecutionMessage,
        ) => {
          const isInterruptAction = interruptMessages.find((m) => m.id === actionMessage.id);
          // Determine follow-up behavior: use action's specific setting if defined, otherwise default based on interrupt status.
          followUp = currentAction?.followUp ?? !isInterruptAction;

          // Call _setActivatingMessageId before executing the action for HITL correlation
          if ((currentAction as any)?._setActivatingMessageId) {
            (currentAction as any)._setActivatingMessageId(actionMessage.id);
          }

          const resultMessage = await executeAction({
            onFunctionCall: onFunctionCall!,
            message: actionMessage,
            chatAbortControllerRef,
            onError: (error: Error) => {
              addErrorToast([error]);
              // console.error is kept here as it's a genuine error in action execution
              console.error(`Failed to execute action ${actionMessage.name}: ${error}`);
            },
            setMessages,
            getFinalMessages: () => finalMessages,
            isRenderAndWait: (currentAction as any)?._isRenderAndWait || false,
          });
          didExecuteAction = true;
          const messageIndex = finalMessages.findIndex((msg) => msg.id === actionMessage.id);
          finalMessages.splice(messageIndex + 1, 0, resultMessage);

          // If the executed action was a renderAndWaitForResponse type, update messages immediately
          // to reflect its completion in the UI, making it interactive promptly.
          if ((currentAction as any)?._isRenderAndWait) {
            const messagesForImmediateUpdate = [...finalMessages];
            flushSync(() => {
              setMessages(messagesForImmediateUpdate);
            });
          }

          // Clear _setActivatingMessageId after the action is done
          if ((currentAction as any)?._setActivatingMessageId) {
            (currentAction as any)._setActivatingMessageId(null);
          }

          return resultMessage;
        };
        // ----------------------------------------------------------------------

        // execute regular action executions that are specific to the frontend (last actions)
        if (onFunctionCall) {
          // Find consecutive action execution messages at the end
          const lastMessages = [];

          for (let i = finalMessages.length - 1; i >= 0; i--) {
            const message = finalMessages[i];
            if (
              (message.isActionExecutionMessage() || message.isResultMessage()) &&
              message.status.code !== MessageStatusCode.Pending
            ) {
              lastMessages.unshift(message);
            } else if (!message.isAgentStateMessage()) {
              break;
            }
          }

          for (const message of lastMessages) {
            // We update the message state before calling the handler so that the render
            // function can be called with `executing` state
            setMessages(finalMessages);

            const action = actions.find(
              (action) => action.name === (message as ActionExecutionMessage).name,
            );
            if (action && action.available === "frontend") {
              // never execute frontend actions
              continue;
            }
            const currentResultMessagePairedFeAction = message.isResultMessage()
              ? getPairedFeAction(actions, message)
              : null;

            // execution message which has an action registered with the hook (remote availability):
            // execute that action first, and then the "paired FE action"
            if (action && message.isActionExecutionMessage()) {
              // For HITL actions, check if they've already been processed to avoid redundant handler calls.
              const isRenderAndWaitAction = (action as any)?._isRenderAndWait || false;
              const alreadyProcessed =
                isRenderAndWaitAction &&
                finalMessages.some(
                  (fm) => fm.isResultMessage() && fm.actionExecutionId === message.id,
                );

              if (alreadyProcessed) {
                // Skip re-execution if already processed
              } else {
                // Call the single, externally defined executeActionFromMessage
                const resultMessage = await executeActionFromMessage(
                  action,
                  message as ActionExecutionMessage,
                );
                const pairedFeAction = getPairedFeAction(actions, resultMessage);

                if (pairedFeAction) {
                  const newExecutionMessage = new ActionExecutionMessage({
                    name: pairedFeAction.name,
                    arguments: parseJson(resultMessage.result, resultMessage.result),
                    status: message.status,
                    createdAt: message.createdAt,
                    parentMessageId: message.parentMessageId,
                  });
                  // Call the single, externally defined executeActionFromMessage
                  await executeActionFromMessage(pairedFeAction, newExecutionMessage);
                }
              }
            } else if (message.isResultMessage() && currentResultMessagePairedFeAction) {
              // Actions which are set up in runtime actions array: Grab the result, executed paired FE action with it as args.
              const newExecutionMessage = new ActionExecutionMessage({
                name: currentResultMessagePairedFeAction.name,
                arguments: parseJson(message.result, message.result),
                status: message.status,
                createdAt: message.createdAt,
              });
              finalMessages.push(newExecutionMessage);
              // Call the single, externally defined executeActionFromMessage
              await executeActionFromMessage(
                currentResultMessagePairedFeAction,
                newExecutionMessage,
              );
            }
          }

          setMessages(finalMessages);
        }

        // Conditionally run chat completion again if followUp is not explicitly false
        // and an action was executed or the last message is a server-side result (for non-agent runs).
        if (
          followUp !== false &&
          (didExecuteAction ||
            // the last message is a server side result
            (!isAgentRun &&
              finalMessages.length &&
              finalMessages[finalMessages.length - 1].isResultMessage())) &&
          // the user did not stop generation
          !chatAbortControllerRef.current?.signal.aborted
        ) {
          // run the completion again and return the result

          // wait for next tick to make sure all the react state updates
          // - tried using react-dom's flushSync, but it did not work
          await new Promise((resolve) => setTimeout(resolve, 10));

          return await runChatCompletionRef.current!(finalMessages);
        } else if (chatAbortControllerRef.current?.signal.aborted) {
          // filter out all the action execution messages that do not have a consecutive matching result message
          const repairedMessages = finalMessages.filter((message, actionExecutionIndex) => {
            if (message.isActionExecutionMessage()) {
              return finalMessages.find(
                (msg, resultIndex) =>
                  msg.isResultMessage() &&
                  msg.actionExecutionId === message.id &&
                  resultIndex === actionExecutionIndex + 1,
              );
            }
            return true;
          });
          const repairedMessageIds = repairedMessages.map((message) => message.id);
          setMessages(repairedMessages);

          // LangGraph needs two pieces of information to continue execution:
          // 1. The threadId
          // 2. The nodeName it came from
          // When stopping the agent, we don't know the nodeName the agent would have ended with
          // Therefore, we set the nodeName to the most reasonable thing we can guess, which
          // is "__end__"
          if (agentSessionRef.current?.nodeName) {
            setAgentSession({
              threadId: agentSessionRef.current.threadId,
              agentName: agentSessionRef.current.agentName,
              nodeName: "__end__",
            });
          }
          // only return new messages that were not filtered out
          return newMessages.filter((message) => repairedMessageIds.includes(message.id));
        } else {
          return newMessages.slice();
        }
      } finally {
        setIsLoading(false);
      }
    },
    [
      messages,
      setMessages,
      makeSystemMessageCallback,
      copilotConfig,
      setIsLoading,
      initialMessages,
      isLoading,
      actions,
      onFunctionCall,
      onCoAgentStateRender,
      setCoagentStatesWithRef,
      coagentStatesRef,
      agentSession,
      setAgentSession,
      disableSystemMessage,
    ],
  );

  runChatCompletionRef.current = runChatCompletion;

  const runChatCompletionAndHandleFunctionCall = useAsyncCallback(
    async (messages: Message[]): Promise<void> => {
      await runChatCompletionRef.current!(messages);
    },
    [messages],
  );

  useEffect(() => {
    if (!isLoading && pendingAppendsRef.current.length > 0) {
      const pending = pendingAppendsRef.current.splice(0);
      const followUp = pending.some((p) => p.followUp);
      const newMessages = [...messages, ...pending.map((p) => p.message)];
      setMessages(newMessages);
      if (followUp) {
        runChatCompletionAndHandleFunctionCall(newMessages);
      }
    }
  }, [isLoading, messages, setMessages, runChatCompletionAndHandleFunctionCall]);

  // Go over all events and see that they include data that should be returned to the agent
  const composeAndFlushMetaEventsInput = useCallback(
    (metaEvents: (MetaEvent | undefined | null)[]) => {
      return metaEvents.reduce((acc: MetaEventInput[], event) => {
        if (!event) return acc;

        switch (event.name) {
          case MetaEventName.LangGraphInterruptEvent:
            if (event.response) {
              // Flush interrupt event from state
              setLangGraphInterruptAction(null);
              const value = (event as LangGraphInterruptEvent).value;
              return [
                ...acc,
                {
                  name: event.name,
                  value: typeof value === "string" ? value : JSON.stringify(value),
                  response:
                    typeof event.response === "string"
                      ? event.response
                      : JSON.stringify(event.response),
                },
              ];
            }
            return acc;
          default:
            return acc;
        }
      }, []);
    },
    [setLangGraphInterruptAction],
  );

  const append = useAsyncCallback(
    async (message: Message, options?: AppendMessageOptions): Promise<void> => {
      const followUp = options?.followUp ?? true;
      if (isLoading) {
        pendingAppendsRef.current.push({ message, followUp });
        return;
      }

      const newMessages = [...messages, message];
      setMessages(newMessages);
      if (followUp) {
        return runChatCompletionAndHandleFunctionCall(newMessages);
      }
    },
    [isLoading, messages, setMessages, runChatCompletionAndHandleFunctionCall],
  );

  const reload = useAsyncCallback(
    async (reloadMessageId: string): Promise<void> => {
      if (isLoading || messages.length === 0) {
        return;
      }

      const reloadMessageIndex = messages.findIndex((msg) => msg.id === reloadMessageId);
      if (reloadMessageIndex === -1) {
        console.warn(`Message with id ${reloadMessageId} not found`);
        return;
      }

      // @ts-expect-error -- message has role
      const reloadMessageRole = messages[reloadMessageIndex].role;
      if (reloadMessageRole !== MessageRole.Assistant) {
        console.warn(`Regenerate cannot be performed on ${reloadMessageRole} role`);
        return;
      }

      let historyCutoff: Message[] = [];
      if (messages.length > 2) {
        // message to regenerate from is now first.
        // Work backwards to find the first the closest user message
        const lastUserMessageBeforeRegenerate = messages
          .slice(0, reloadMessageIndex)
          .reverse()
          .find(
            (msg) =>
              // @ts-expect-error -- message has role
              msg.role === MessageRole.User,
          );
        const indexOfLastUserMessageBeforeRegenerate = messages.findIndex(
          (msg) => msg.id === lastUserMessageBeforeRegenerate!.id,
        );

        // Include the user message, remove everything after it
        historyCutoff = messages.slice(0, indexOfLastUserMessageBeforeRegenerate + 1);
      }

      setMessages(historyCutoff);

      return runChatCompletionAndHandleFunctionCall(historyCutoff);
    },
    [isLoading, messages, setMessages, runChatCompletionAndHandleFunctionCall],
  );

  const stop = (): void => {
    chatAbortControllerRef.current?.abort("Stop was called");
  };

  return {
    append,
    reload,
    stop,
    runChatCompletion: () => runChatCompletionRef.current!(messages),
  };
}

function constructFinalMessages(
  syncedMessages: Message[],
  previousMessages: Message[],
  newMessages: Message[],
): Message[] {
  const finalMessages =
    syncedMessages.length > 0 ? [...syncedMessages] : [...previousMessages, ...newMessages];

  if (syncedMessages.length > 0) {
    const messagesWithAgentState = [...previousMessages, ...newMessages];

    let previousMessageId: string | undefined = undefined;

    for (const message of messagesWithAgentState) {
      if (message.isAgentStateMessage()) {
        // insert this message into finalMessages after the position of previousMessageId
        const index = finalMessages.findIndex((msg) => msg.id === previousMessageId);
        if (index !== -1) {
          finalMessages.splice(index + 1, 0, message);
        }
      }

      previousMessageId = message.id;
    }
  }

  return finalMessages;
}

async function executeAction({
  onFunctionCall,
  message,
  chatAbortControllerRef,
  onError,
  setMessages,
  getFinalMessages,
  isRenderAndWait,
}: {
  onFunctionCall: FunctionCallHandler;
  message: ActionExecutionMessage;
  chatAbortControllerRef: React.MutableRefObject<AbortController | null>;
  onError: (error: Error) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  getFinalMessages: () => Message[];
  isRenderAndWait: boolean;
}) {
  let result: any;
  let error: Error | null = null;

  const currentMessagesForHandler = getFinalMessages();

  // The handler (onFunctionCall) runs its synchronous part here, potentially setting up
  // renderAndWaitRef.current for HITL actions via useCopilotAction's transformed handler.
  const handlerReturnedPromise = onFunctionCall({
    messages: currentMessagesForHandler,
    name: message.name,
    args: message.arguments,
  });

  // For HITL actions, call flushSync immediately after their handler has set up the promise
  // and before awaiting the promise. This ensures the UI updates to an interactive state.
  if (isRenderAndWait) {
    const currentMessagesForRender = getFinalMessages();
    flushSync(() => {
      setMessages([...currentMessagesForRender]);
    });
  }

  try {
    result = await Promise.race([
      handlerReturnedPromise, // Await the promise returned by the handler
      new Promise((resolve) =>
        chatAbortControllerRef.current?.signal.addEventListener("abort", () =>
          resolve("Operation was aborted by the user"),
        ),
      ),
      // if the user stopped generation, we also abort consecutive actions
      new Promise((resolve) => {
        if (chatAbortControllerRef.current?.signal.aborted) {
          resolve("Operation was aborted by the user");
        }
      }),
    ]);
  } catch (e) {
    onError(e as Error);
  }
  return new ResultMessage({
    id: "result-" + message.id,
    result: ResultMessage.encodeResult(
      error
        ? {
            content: result,
            error: JSON.parse(JSON.stringify(error, Object.getOwnPropertyNames(error))),
          }
        : result,
    ),
    actionExecutionId: message.id,
    actionName: message.name,
  });
}

function getPairedFeAction(
  actions: FrontendAction<any>[],
  message: ActionExecutionMessage | ResultMessage,
) {
  let actionName = null;
  if (message.isActionExecutionMessage()) {
    actionName = message.name;
  } else if (message.isResultMessage()) {
    actionName = message.actionName;
  }
  return actions.find(
    (action) =>
      (action.name === actionName && action.available === "frontend") ||
      action.pairedAction === actionName,
  );
}
