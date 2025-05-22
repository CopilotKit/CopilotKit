import React, { useCallback, useRef } from "react";
import {
  FunctionCallHandler,
  COPILOT_CLOUD_PUBLIC_API_KEY_HEADER,
  CoAgentStateRenderHandler,
  randomId,
  parseJson,
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
import { AgentSession } from "../context/copilot-context";
import { useCopilotRuntimeClient } from "./use-copilot-runtime-client";
import { useAsyncCallback, useErrorToast } from "../components/error-boundary/error-utils";
import {
  LangGraphInterruptAction,
  LangGraphInterruptActionSetter,
} from "../types/interrupt-action";

// Global execution state tracker - updated with better synchronization
let isExecutingAction = false;
let executionQueue: Array<() => Promise<void>> = [];
let currentExecutingActionName: string | null = null;
let currentExecutingMessageId: string | null = null;
let didExecuteActionGlobal = false; // Track if any action was executed during this completion

// Function to process the queue with better synchronization
async function processNextActionInQueue() {
  if (executionQueue.length === 0 || isExecutingAction) {
    return;
  }
  
  isExecutingAction = true;
  
  const nextAction = executionQueue.shift();
  try {
    await nextAction!();
  } catch (e) {
    console.error(`Error executing queued action:`, e);
  } finally {
    // Always reset the executing flag to prevent deadlocks
    isExecutingAction = false;
    currentExecutingActionName = null;
    currentExecutingMessageId = null;
    
    // Add a delay between processing queue items to ensure UI updates
    if (executionQueue.length > 0) {
      setTimeout(() => processNextActionInQueue(), 250); // Increased delay to ensure UI updates
    }
  }
}

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
  } = options;
  const runChatCompletionRef = useRef<(previousMessages: Message[]) => Promise<Message[]>>();
  const addErrorToast = useErrorToast();
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

  const runtimeClient = useCopilotRuntimeClient({
    url: copilotConfig.chatApiEndpoint,
    publicApiKey: copilotConfig.publicApiKey,
    headers,
    credentials: copilotConfig.credentials,
  });

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

      const systemMessage = makeSystemMessageCallback();

      const messagesWithContext = [systemMessage, ...(initialMessages || []), ...previousMessages];

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

          if (messages.length === 0) {
            continue;
          }

          newMessages = [];

          // request failed, display error message and quit
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
            setMessages([...previousMessages, ...newMessages]);
            break;
          }

          // add messages to the chat
          else {
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
            const currentResultMessagePairedFeAction = message.isResultMessage()
              ? getPairedFeAction(actions, message)
              : null;

            // execution message which has an action registered with the hook (remote availability):
            // execute that action first, and then the "paired FE action"
            if (action && message.isActionExecutionMessage()) {
              const resultMessage = await executeActionFromMessage(
                action, 
                message, 
                onFunctionCall, 
                previousMessages, 
                chatAbortControllerRef, 
                (error: Error) => addErrorToast([error]), 
                actions, 
                setMessages, 
                finalMessages,
                { value: followUp }
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
                
                await executeActionFromMessage(
                  pairedFeAction, 
                  newExecutionMessage, 
                  onFunctionCall, 
                  previousMessages, 
                  chatAbortControllerRef, 
                  (error: Error) => addErrorToast([error]), 
                  actions, 
                  setMessages, 
                  finalMessages,
                  { value: followUp }
                );
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
              
              await executeActionFromMessage(
                currentResultMessagePairedFeAction, 
                newExecutionMessage, 
                onFunctionCall, 
                previousMessages, 
                chatAbortControllerRef, 
                (error: Error) => addErrorToast([error]), 
                actions, 
                setMessages, 
                finalMessages,
                { value: followUp }
              );
            }
          }

          setMessages(finalMessages);
        }

        // Check for any "stuck" action execution messages that are in executing state without result
        const executingMessages = finalMessages.filter(msg => 
          msg.isActionExecutionMessage() && 
          msg.status.code === MessageStatusCode.Success &&
          !finalMessages.find(resultMsg => 
            resultMsg.isResultMessage() && 
            resultMsg.actionExecutionId === msg.id
          )
        );

        if (executingMessages.length > 0) {
          // Force reset of execution state 
          isExecutingAction = false;
          currentExecutingActionName = null;
          currentExecutingMessageId = null;
          
          // Clean up global state
          (window as any).__COPILOT_CURRENT_ACTION_MESSAGE_ID__ = undefined;
          (window as any).__COPILOT_CURRENT_ACTION_NAME__ = undefined;
          
          // If we've been waiting for a while with executing messages, force follow-up
          if (!didExecuteAction && !didExecuteActionGlobal) {
            didExecuteActionGlobal = true;
          }
        }

        // Check for explicit noFollowUp in the most recent action
        const lastActionMessage = finalMessages
          .filter(msg => msg.isActionExecutionMessage())
          .pop();
        
        const lastAction = lastActionMessage 
          ? actions.find(a => a.name === (lastActionMessage as ActionExecutionMessage).name) 
          : null;
        
        // If the last action has followUp: false, override the global followUp value
        if (lastAction && lastAction.followUp === false) {
          followUp = false;
        }

        // Before we decide on follow-up, check if we did execute any actions
        const didExecuteAnyAction = didExecuteAction || didExecuteActionGlobal;

        if (
          // Only follow up if followUp is not explicitly false
          followUp !== false &&
          // And we actually executed an action or got a result
          (didExecuteAnyAction ||
            // Or the last message is a server side result
            (!isAgentRun &&
              finalMessages.length &&
              finalMessages[finalMessages.length - 1].isResultMessage())) &&
          // And the user did not stop generation
          !chatAbortControllerRef.current?.signal.aborted
        ) {
          // Log the followUp state for debugging
          console.log(`[CopilotKit] Follow-up triggered: followUp=${followUp}, didExecuteAction=${didExecuteAction}, didExecuteActionGlobal=${didExecuteActionGlobal}`);
          
          // Clean up any lingering UI state
          (window as any).__COPILOT_CURRENT_ACTION_MESSAGE_ID__ = undefined;
          (window as any).__COPILOT_CURRENT_ACTION_NAME__ = undefined;
          
          // Reset action execution tracking
          didExecuteActionGlobal = false;
          
          // Add a longer delay before running the next completion to ensure UI is fully updated
          await new Promise((resolve) => setTimeout(resolve, 300));
          
          // Clear any pending queue items for safety
          if (executionQueue.length > 0) {
            executionQueue = [];
          }
          
          // Make sure execution state is reset
          isExecutingAction = false;
          currentExecutingActionName = null;
          currentExecutingMessageId = null;
          
          // Force React to flush any pending updates first
          setMessages([...finalMessages]);
          await new Promise((resolve) => setTimeout(resolve, 50));
          
          return await runChatCompletionRef.current!(finalMessages);
        } else if (chatAbortControllerRef.current?.signal.aborted) {
          // Log when no follow-up is triggered
          if (followUp === false) {
            console.log(`[CopilotKit] No follow-up due to followUp=${followUp}`);
          }
          
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
    ],
  );

  runChatCompletionRef.current = runChatCompletion;

  const runChatCompletionAndHandleFunctionCall = useAsyncCallback(
    async (messages: Message[]): Promise<void> => {
      await runChatCompletionRef.current!(messages);
    },
    [messages],
  );

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
      if (isLoading) {
        return;
      }

      const newMessages = [...messages, message];
      setMessages(newMessages);
      // Only avoid follow-up if options.followUp is explicitly false
      const followUp = options?.followUp !== false;
      if (followUp) {
        return runChatCompletionAndHandleFunctionCall(newMessages);
      }
    },
    [isLoading, messages, setMessages, runChatCompletionAndHandleFunctionCall],
  );

  const reload = useAsyncCallback(
    async (messageId: string): Promise<void> => {
      if (isLoading || messages.length === 0) {
        return;
      }

      const index = messages.findIndex((msg) => msg.id === messageId);
      if (index === -1) {
        console.warn(`Message with id ${messageId} not found`);
        return;
      }

      let newMessages = messages.slice(0, index); // excludes the message with messageId
      if (newMessages.length > 0 && newMessages[newMessages.length - 1].isAgentStateMessage()) {
        newMessages = newMessages.slice(0, newMessages.length - 1); // remove last one too
      }

      setMessages(newMessages);

      return runChatCompletionAndHandleFunctionCall(newMessages);
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
  previousMessages,
  message,
  chatAbortControllerRef,
  onError,
  currentAction,
  allActions,
}: {
  onFunctionCall: FunctionCallHandler;
  previousMessages: Message[];
  message: ActionExecutionMessage;
  chatAbortControllerRef: React.MutableRefObject<AbortController | null>;
  onError: (error: Error) => void;
  currentAction?: FrontendAction<any>;
  allActions?: FrontendAction<any>[];
}) {
  // Clear any previous global state
  if ((window as any).__COPILOT_CURRENT_ACTION_MESSAGE_ID__ !== message.id ||
      (window as any).__COPILOT_CURRENT_ACTION_NAME__ !== message.name) {
    (window as any).__COPILOT_CURRENT_ACTION_MESSAGE_ID__ = undefined;
    (window as any).__COPILOT_CURRENT_ACTION_NAME__ = undefined;
    
    // Force a state refresh to clear any lingering UI state
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // Before executing the action, make this message ID globally available
  // This is a workaround for timing issues with HITL actions
  // The global variable will be used in the HITL action handler to immediately
  // associate the promise with this message ID
  (window as any).__COPILOT_CURRENT_ACTION_MESSAGE_ID__ = message.id;
  (window as any).__COPILOT_CURRENT_ACTION_NAME__ = message.name;
  
  // Track the current executing action
  currentExecutingActionName = message.name;
  currentExecutingMessageId = message.id;
  
  // Set a flag to track if this is a HITL action - use the passed action if available
  // otherwise fall back to searching through all actions
  const isHitlAction = currentAction 
    ? currentAction.renderAndWait || currentAction.renderAndWaitForResponse
    : allActions?.find(a => a.name === message.name)?.renderAndWait || 
      allActions?.find(a => a.name === message.name)?.renderAndWaitForResponse;
  
  // For HITL actions, force a UI refresh before executing to ensure components are ready
  if (isHitlAction) {
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  
  let result: any;
  let error: Error | null = null;
  try {
    // Set a longer timeout for HITL actions to allow user interaction
    const timeoutPromise = new Promise((_, reject) => {
      // Much longer timeout for human-in-the-loop actions (10 minutes)
      // Regular actions should resolve much faster
      const timeoutId = setTimeout(() => {
        reject(new Error(`Action ${message.name} timed out after 10 minutes`));
      }, 10 * 60 * 1000);
      
      // Clear the timeout if the chat is aborted
      chatAbortControllerRef.current?.signal.addEventListener("abort", () => {
        clearTimeout(timeoutId);
      });
    });
    
    result = await Promise.race([
      // Run the action handler
      onFunctionCall({
        messages: previousMessages,
        name: message.name,
        args: message.arguments,
      }),
      // Abort if the user stops the generation
      new Promise((resolve) =>
        chatAbortControllerRef.current?.signal.addEventListener("abort", () => {
          resolve("Operation was aborted by the user");
        }),
      ),
      // Check if already aborted
      new Promise((resolve) => {
        if (chatAbortControllerRef.current?.signal.aborted) {
          resolve("Operation was aborted by the user");
        }
      }),
      // Timeout for safety
      timeoutPromise,
    ]);
  } catch (e) {
    error = e as Error;
    onError(e as Error);
  } finally {
    // Ensure all UI updates are complete before clearing globals
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Clean up the global variable
    (window as any).__COPILOT_CURRENT_ACTION_MESSAGE_ID__ = undefined;
    (window as any).__COPILOT_CURRENT_ACTION_NAME__ = undefined;
    
    // Reset the current executing action
    currentExecutingActionName = null;
    currentExecutingMessageId = null;
    
    // For HITL actions, ensure all related promises are properly cleaned up
    if (isHitlAction) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  const resultMessage = new ResultMessage({
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
  
  // Track that we executed an action
  didExecuteActionGlobal = true;
  
  return resultMessage;
}

// Improved helper function to execute actions from messages with better sequencing
async function executeActionFromMessage(
  action: FrontendAction<any>,
  message: ActionExecutionMessage,
  onFunctionCall: FunctionCallHandler,
  previousMessages: Message[],
  chatAbortControllerRef: React.MutableRefObject<AbortController | null>,
  onErrorCallback: (error: Error) => void,
  allActions: FrontendAction<any>[],
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  finalMessages: Message[],
  followUpRef?: { value: FrontendAction["followUp"] }
): Promise<ResultMessage> {
  // Check if this action explicitly has followUp set to false
  const hasExplicitNoFollowUp = action?.followUp === false;
  
  // Update the followUp reference if provided
  if (followUpRef && hasExplicitNoFollowUp) {
    // If this action explicitly disables follow-up, override any previous settings
    // This is the ONLY place we should set followUp to false
    followUpRef.value = false;
  }
  
  // Identify if this is a HITL action
  const isHitlAction = action.renderAndWait || action.renderAndWaitForResponse;
  
  return new Promise<ResultMessage>((resolve) => {
    const actionExecution = async () => {
      // If another HITL action is already running for this action type, add additional delay
      if (isHitlAction && currentExecutingActionName === message.name && currentExecutingMessageId !== message.id) {
        await new Promise(r => setTimeout(r, 500));
      }
      
      // Clear any lingering promises for this action message
      if (isHitlAction) {
        const clearHitlGlobals = () => {
          if ((window as any).__COPILOT_CURRENT_ACTION_MESSAGE_ID__ !== message.id) {
            (window as any).__COPILOT_CURRENT_ACTION_MESSAGE_ID__ = undefined;
            (window as any).__COPILOT_CURRENT_ACTION_NAME__ = undefined;
          }
        };
        
        clearHitlGlobals();
      }
      
      // Make sure there's a small delay between executing actions
      // This allows the UI to update and React to re-render between actions
      await new Promise(r => setTimeout(r, 100));
      
      // Force any pending UI updates by flushing the React queue
      await new Promise(r => setTimeout(r, 0));
      
      // Update the messages state before executing to ensure render components have latest state
      setMessages([...finalMessages]);
      
      // Add special handling for HITL actions to ensure they're fully processed
      if (isHitlAction) {
        // Give extra time for the UI to update and be ready for user interaction
        await new Promise(r => setTimeout(r, 200)); // Increased from 150 to 200ms
      }
      
      try {
        const resultMessage = await executeAction({
          onFunctionCall,
          previousMessages,
          message,
          chatAbortControllerRef,
          onError: (error: Error) => {
            onErrorCallback(error);
            console.error(`Failed to execute action ${message.name}: ${error}`);
          },
          currentAction: action,
          allActions,
        });
        
        // Set the global flag to indicate an action was executed
        didExecuteActionGlobal = true;
        
        const messageIndex = finalMessages.findIndex((msg) => msg.id === message.id);
        
        // Immediately insert the result message after the action message
        if (messageIndex !== -1) {
          finalMessages.splice(messageIndex + 1, 0, resultMessage);
        } else {
          // If for some reason the action message isn't found, add the result to the end
          finalMessages.push(resultMessage);
        }
        
        // Update messages to show the result immediately
        setMessages([...finalMessages]);
        
        // For HITL actions, add additional cleanup delay
        if (isHitlAction) {
          await new Promise(r => setTimeout(r, 300)); // Increased from 200 to 300ms
        }
        
        // Add a general cleanup delay for all actions to ensure proper state updates
        await new Promise(r => setTimeout(r, 150)); // Increased from 100 to 150ms
        
        // Always ensure HITL globals are cleared
        (window as any).__COPILOT_CURRENT_ACTION_MESSAGE_ID__ = undefined;
        (window as any).__COPILOT_CURRENT_ACTION_NAME__ = undefined;
        
        resolve(resultMessage);
      } catch (error) {
        // Create a default result message on error
        const errorResultMessage = new ResultMessage({
          id: "result-" + message.id,
          result: ResultMessage.encodeResult({
            content: null,
            error: JSON.parse(JSON.stringify(error, Object.getOwnPropertyNames(error))),
          }),
          actionExecutionId: message.id,
          actionName: message.name,
        });
        
        // Always ensure HITL globals are cleared
        (window as any).__COPILOT_CURRENT_ACTION_MESSAGE_ID__ = undefined;
        (window as any).__COPILOT_CURRENT_ACTION_NAME__ = undefined;
        
        resolve(errorResultMessage);
      }
    };
    
    // Add this action to the execution queue
    executionQueue.push(actionExecution);
    
    // Start processing the queue if not already running
    if (!isExecutingAction) {
      processNextActionInQueue();
    }
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
