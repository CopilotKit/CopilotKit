/**
 * <Callout type="info">
 *   This is the reference for the `CopilotRuntime` class. For more information and example code snippets, please see [Concept: Copilot Runtime](/concepts/copilot-runtime).
 * </Callout>
 *
 * ## Usage
 *
 * ```tsx
 * import { CopilotRuntime } from "@copilotkit/runtime";
 *
 * const copilotKit = new CopilotRuntime();
 * ```
 */

import {
  Action,
  actionParametersToJsonSchema,
  Parameter,
  ResolvedCopilotKitError,
  CopilotKitApiDiscoveryError,
  randomId,
  CopilotKitError,
  CopilotKitLowLevelError,
  CopilotKitAgentDiscoveryError,
  CopilotKitMisuseError,
} from "@copilotkit/shared";
import {
  CopilotServiceAdapter,
  EmptyAdapter,
  RemoteChain,
  RemoteChainParameters,
} from "../../service-adapters";

import { MessageInput } from "../../graphql/inputs/message.input";
import { ActionInput } from "../../graphql/inputs/action.input";
import { RuntimeEventSource, RuntimeEventTypes } from "../../service-adapters/events";
import { convertGqlInputToMessages } from "../../service-adapters/conversion";
import { Message } from "../../graphql/types/converted";
import { ForwardedParametersInput } from "../../graphql/inputs/forwarded-parameters.input";

import {
  isRemoteAgentAction,
  RemoteAgentAction,
  EndpointType,
  setupRemoteActions,
  EndpointDefinition,
  CopilotKitEndpoint,
  LangGraphPlatformEndpoint,
} from "./remote-actions";

import { GraphQLContext } from "../integrations/shared";
import { AgentSessionInput } from "../../graphql/inputs/agent-session.input";
import { from } from "rxjs";
import { AgentStateInput } from "../../graphql/inputs/agent-state.input";
import { ActionInputAvailability } from "../../graphql/types/enums";
import { createHeaders } from "./remote-action-constructors";
import { Agent } from "../../graphql/types/agents-response.type";
import { ExtensionsInput } from "../../graphql/inputs/extensions.input";
import { ExtensionsResponse } from "../../graphql/types/extensions-response.type";
import { LoadAgentStateResponse } from "../../graphql/types/load-agent-state-response.type";
import { Client as LangGraphClient } from "@langchain/langgraph-sdk";
import { langchainMessagesToCopilotKit } from "./remote-lg-action";
import { MetaEventInput } from "../../graphql/inputs/meta-event.input";
import {
  CopilotObservabilityConfig,
  LLMRequestData,
  LLMResponseData,
  LLMErrorData,
} from "../observability";

interface CopilotRuntimeRequest {
  serviceAdapter: CopilotServiceAdapter;
  messages: MessageInput[];
  actions: ActionInput[];
  agentSession?: AgentSessionInput;
  agentStates?: AgentStateInput[];
  outputMessagesPromise: Promise<Message[]>;
  threadId?: string;
  runId?: string;
  publicApiKey?: string;
  graphqlContext: GraphQLContext;
  forwardedParameters?: ForwardedParametersInput;
  url?: string;
  extensions?: ExtensionsInput;
  metaEvents?: MetaEventInput[];
}

interface CopilotRuntimeResponse {
  threadId: string;
  runId?: string;
  eventSource: RuntimeEventSource;
  serverSideActions: Action<any>[];
  actionInputsWithoutAgents: ActionInput[];
  extensions?: ExtensionsResponse;
}

type ActionsConfiguration<T extends Parameter[] | [] = []> =
  | Action<T>[]
  | ((ctx: { properties: any; url?: string }) => Action<T>[]);

interface OnBeforeRequestOptions {
  threadId?: string;
  runId?: string;
  inputMessages: Message[];
  properties: any;
  url?: string;
}

type OnBeforeRequestHandler = (options: OnBeforeRequestOptions) => void | Promise<void>;

interface OnAfterRequestOptions {
  threadId: string;
  runId?: string;
  inputMessages: Message[];
  outputMessages: Message[];
  properties: any;
  url?: string;
}

type OnAfterRequestHandler = (options: OnAfterRequestOptions) => void | Promise<void>;

interface Middleware {
  /**
   * A function that is called before the request is processed.
   */
  onBeforeRequest?: OnBeforeRequestHandler;

  /**
   * A function that is called after the request is processed.
   */
  onAfterRequest?: OnAfterRequestHandler;
}

type AgentWithEndpoint = Agent & { endpoint: EndpointDefinition };

export interface CopilotRuntimeConstructorParams<T extends Parameter[] | [] = []> {
  /**
   * Middleware to be used by the runtime.
   *
   * ```ts
   * onBeforeRequest: (options: {
   *   threadId?: string;
   *   runId?: string;
   *   inputMessages: Message[];
   *   properties: any;
   * }) => void | Promise<void>;
   * ```
   *
   * ```ts
   * onAfterRequest: (options: {
   *   threadId?: string;
   *   runId?: string;
   *   inputMessages: Message[];
   *   outputMessages: Message[];
   *   properties: any;
   * }) => void | Promise<void>;
   * ```
   */
  middleware?: Middleware;

  /*
   * A list of server side actions that can be executed. Will be ignored when remoteActions are set
   */
  actions?: ActionsConfiguration<T>;

  /*
   * Deprecated: Use `remoteEndpoints`.
   */
  remoteActions?: CopilotKitEndpoint[];

  /*
   * A list of remote actions that can be executed.
   */
  remoteEndpoints?: EndpointDefinition[];

  /*
   * An array of LangServer URLs.
   */
  langserve?: RemoteChainParameters[];

  /*
   * Delegates agent state processing to the service adapter.
   *
   * When enabled, individual agent state requests will not be processed by the agent itself.
   * Instead, all processing will be handled by the service adapter.
   */
  delegateAgentProcessingToServiceAdapter?: boolean;

  /**
   * Configuration for LLM request/response logging.
   * Requires publicApiKey from CopilotKit component to be set:
   *
   * ```tsx
   * <CopilotKit publicApiKey="ck_pub_..." />
   * ```
   *
   * Example logging config:
   * ```ts
   * logging: {
   *   enabled: true, // Enable or disable logging
   *   progressive: true, // Set to false for buffered logging
   *   logger: {
   *     logRequest: (data) => langfuse.trace({ name: "LLM Request", input: data }),
   *     logResponse: (data) => langfuse.trace({ name: "LLM Response", output: data }),
   *     logError: (errorData) => langfuse.trace({ name: "LLM Error", metadata: errorData }),
   *   },
   * }
   * ```
   */
  observability_c?: CopilotObservabilityConfig;
}

export class CopilotRuntime<const T extends Parameter[] | [] = []> {
  public actions: ActionsConfiguration<T>;
  public remoteEndpointDefinitions: EndpointDefinition[];
  private langserve: Promise<Action<any>>[] = [];
  private onBeforeRequest?: OnBeforeRequestHandler;
  private onAfterRequest?: OnAfterRequestHandler;
  private delegateAgentProcessingToServiceAdapter: boolean;
  private observability?: CopilotObservabilityConfig;

  constructor(params?: CopilotRuntimeConstructorParams<T>) {
    if (
      params?.actions &&
      params?.remoteEndpoints &&
      params?.remoteEndpoints.some((e) => e.type === EndpointType.LangGraphPlatform)
    ) {
      console.warn("Actions set in runtime instance will not be available for the agent");
    }
    this.actions = params?.actions || [];

    for (const chain of params?.langserve || []) {
      const remoteChain = new RemoteChain(chain);
      this.langserve.push(remoteChain.toAction());
    }

    this.remoteEndpointDefinitions = params?.remoteEndpoints ?? params?.remoteActions ?? [];

    this.onBeforeRequest = params?.middleware?.onBeforeRequest;
    this.onAfterRequest = params?.middleware?.onAfterRequest;
    this.delegateAgentProcessingToServiceAdapter =
      params?.delegateAgentProcessingToServiceAdapter || false;
    this.observability = params?.observability_c;
  }

  async processRuntimeRequest(request: CopilotRuntimeRequest): Promise<CopilotRuntimeResponse> {
    const {
      serviceAdapter,
      messages: rawMessages,
      actions: clientSideActionsInput,
      threadId,
      runId,
      outputMessagesPromise,
      graphqlContext,
      forwardedParameters,
      url,
      extensions,
      agentSession,
      agentStates,
      publicApiKey,
    } = request;

    const eventSource = new RuntimeEventSource();
    // Track request start time for logging
    const requestStartTime = Date.now();
    // For storing streamed chunks if progressive logging is enabled
    const streamedChunks: any[] = [];

    try {
      if (agentSession && !this.delegateAgentProcessingToServiceAdapter) {
        return await this.processAgentRequest(request);
      }
      if (serviceAdapter instanceof EmptyAdapter) {
        throw new CopilotKitMisuseError({
          message: `Invalid adapter configuration: EmptyAdapter is only meant to be used with agent lock mode. 
For non-agent components like useCopilotChatSuggestions, CopilotTextarea, or CopilotTask, 
please use an LLM adapter instead.`,
        });
      }

      const messages = rawMessages.filter((message) => !message.agentStateMessage);
      const inputMessages = convertGqlInputToMessages(messages);
      const serverSideActions = await this.getServerSideActions(request);

      // Log LLM request if logging is enabled
      if (this.observability?.enabled && publicApiKey) {
        try {
          const requestData: LLMRequestData = {
            threadId,
            runId,
            model: forwardedParameters?.model,
            messages: inputMessages,
            actions: clientSideActionsInput,
            forwardedParameters,
            timestamp: requestStartTime,
            provider: this.detectProvider(serviceAdapter),
          };

          await this.observability.hooks.handleRequest(requestData);
        } catch (error) {
          console.error("Error logging LLM request:", error);
        }
      }

      const serverSideActionsInput: ActionInput[] = serverSideActions.map((action) => ({
        name: action.name,
        description: action.description,
        jsonSchema: JSON.stringify(actionParametersToJsonSchema(action.parameters)),
      }));

      const actionInputs = flattenToolCallsNoDuplicates([
        ...serverSideActionsInput,
        ...clientSideActionsInput.filter(
          // Filter remote actions from CopilotKit core loop
          (action) => action.available !== ActionInputAvailability.remote,
        ),
      ]);

      await this.onBeforeRequest?.({
        threadId,
        runId,
        inputMessages,
        properties: graphqlContext.properties,
        url,
      });

      const result = await serviceAdapter.process({
        messages: inputMessages,
        actions: actionInputs,
        threadId,
        runId,
        eventSource,
        forwardedParameters,
        extensions,
        agentSession,
        agentStates,
      });

      // for backwards compatibility, we deal with the case that no threadId is provided
      // by the frontend, by using the threadId from the response
      const nonEmptyThreadId = threadId ?? result.threadId;

      outputMessagesPromise
        .then((outputMessages) => {
          this.onAfterRequest?.({
            threadId: nonEmptyThreadId,
            runId: result.runId,
            inputMessages,
            outputMessages,
            properties: graphqlContext.properties,
            url,
          });
        })
        .catch((_error) => {});

      // After getting the response, log it if logging is enabled
      if (this.observability?.enabled && publicApiKey) {
        try {
          outputMessagesPromise
            .then((outputMessages) => {
              const responseData: LLMResponseData = {
                threadId: result.threadId,
                runId: result.runId,
                model: forwardedParameters?.model,
                // Use collected chunks for progressive mode or outputMessages for regular mode
                output: this.observability.progressive ? streamedChunks : outputMessages,
                latency: Date.now() - requestStartTime,
                timestamp: Date.now(),
                provider: this.detectProvider(serviceAdapter),
                // Indicate this is the final response
                isFinalResponse: true,
              };

              try {
                this.observability.hooks.handleResponse(responseData);
              } catch (logError) {
                console.error("Error logging LLM response:", logError);
              }
            })
            .catch((error) => {
              console.error("Failed to get output messages for logging:", error);
            });
        } catch (error) {
          console.error("Error setting up logging for LLM response:", error);
        }
      }

      // Add progressive logging if enabled
      if (this.observability?.enabled && this.observability.progressive && publicApiKey) {
        // Keep reference to original stream function
        const originalStream = eventSource.stream.bind(eventSource);

        // Wrap the stream function to intercept events
        eventSource.stream = async (callback) => {
          await originalStream(async (eventStream$) => {
            // Create subscription to capture streaming events
            eventStream$.subscribe({
              next: (event) => {
                // Only log content chunks
                if (event.type === RuntimeEventTypes.TextMessageContent) {
                  // Store the chunk
                  streamedChunks.push(event.content);

                  // Log each chunk separately for progressive mode
                  try {
                    const progressiveData: LLMResponseData = {
                      threadId: threadId || "",
                      runId,
                      model: forwardedParameters?.model,
                      output: event.content,
                      latency: Date.now() - requestStartTime,
                      timestamp: Date.now(),
                      provider: this.detectProvider(serviceAdapter),
                      isProgressiveChunk: true,
                    };

                    // Use Promise to handle async logger without awaiting
                    Promise.resolve()
                      .then(() => {
                        this.observability.hooks.handleResponse(progressiveData);
                      })
                      .catch((error) => {
                        console.error("Error in progressive logging:", error);
                      });
                  } catch (error) {
                    console.error("Error preparing progressive log data:", error);
                  }
                }
              },
            });

            // Call the original callback with the event stream
            await callback(eventStream$);
          });
        };
      }

      return {
        threadId: nonEmptyThreadId,
        runId: result.runId,
        eventSource,
        serverSideActions,
        actionInputsWithoutAgents: actionInputs.filter(
          (action) =>
            // TODO-AGENTS: do not exclude ALL server side actions
            !serverSideActions.find((serverSideAction) => serverSideAction.name == action.name),
          // !isRemoteAgentAction(
          //   serverSideActions.find((serverSideAction) => serverSideAction.name == action.name),
          // ),
        ),
        extensions: result.extensions,
      };
    } catch (error) {
      // Log error if logging is enabled
      if (this.observability?.enabled && publicApiKey) {
        try {
          const errorData: LLMErrorData = {
            threadId,
            runId,
            model: forwardedParameters?.model,
            error: error instanceof Error ? error : String(error),
            timestamp: Date.now(),
            latency: Date.now() - requestStartTime,
            provider: this.detectProvider(serviceAdapter),
          };

          await this.observability.hooks.handleError(errorData);
        } catch (logError) {
          console.error("Error logging LLM error:", logError);
        }
      }

      if (error instanceof CopilotKitError) {
        throw error;
      }
      console.error("Error getting response:", error);
      eventSource.sendErrorMessageToChat();
      throw error;
    }
  }

  async discoverAgentsFromEndpoints(graphqlContext: GraphQLContext): Promise<AgentWithEndpoint[]> {
    const agents = this.remoteEndpointDefinitions.reduce(
      async (acc: Promise<Agent[]>, endpoint) => {
        const agents = await acc;
        if (endpoint.type === EndpointType.LangGraphPlatform) {
          const propertyHeaders = graphqlContext.properties.authorization
            ? { authorization: `Bearer ${graphqlContext.properties.authorization}` }
            : null;

          const client = new LangGraphClient({
            apiUrl: endpoint.deploymentUrl,
            apiKey: endpoint.langsmithApiKey,
            defaultHeaders: { ...propertyHeaders },
          });

          const data: Array<{ assistant_id: string; graph_id: string }> =
            await client.assistants.search();

          const endpointAgents = (data ?? []).map((entry) => ({
            name: entry.graph_id,
            id: entry.assistant_id,
            description: "",
            endpoint,
          }));
          return [...agents, ...endpointAgents];
        }

        interface InfoResponse {
          agents?: Array<{
            name: string;
            description: string;
          }>;
        }
        const cpkEndpoint = endpoint as CopilotKitEndpoint;
        const fetchUrl = `${endpoint.url}/info`;
        try {
          const response = await fetch(fetchUrl, {
            method: "POST",
            headers: createHeaders(cpkEndpoint.onBeforeRequest, graphqlContext),
            body: JSON.stringify({ properties: graphqlContext.properties }),
          });
          if (!response.ok) {
            if (response.status === 404) {
              throw new CopilotKitApiDiscoveryError({ url: fetchUrl });
            }
            throw new ResolvedCopilotKitError({
              status: response.status,
              url: fetchUrl,
              isRemoteEndpoint: true,
            });
          }

          const data: InfoResponse = await response.json();
          const endpointAgents = (data?.agents ?? []).map((agent) => ({
            name: agent.name,
            description: agent.description ?? "" ?? "",
            id: randomId(), // Required by Agent type
            endpoint,
          }));
          return [...agents, ...endpointAgents];
        } catch (error) {
          if (error instanceof CopilotKitError) {
            throw error;
          }
          throw new CopilotKitLowLevelError({ error: error as Error, url: fetchUrl });
        }
      },
      Promise.resolve([]),
    );

    return agents;
  }

  async loadAgentState(
    graphqlContext: GraphQLContext,
    threadId: string,
    agentName: string,
  ): Promise<LoadAgentStateResponse> {
    const agentsWithEndpoints = await this.discoverAgentsFromEndpoints(graphqlContext);

    const agentWithEndpoint = agentsWithEndpoints.find((agent) => agent.name === agentName);
    if (!agentWithEndpoint) {
      throw new Error("Agent not found");
    }

    if (agentWithEndpoint.endpoint.type === EndpointType.LangGraphPlatform) {
      const propertyHeaders = graphqlContext.properties.authorization
        ? { authorization: `Bearer ${graphqlContext.properties.authorization}` }
        : null;

      const client = new LangGraphClient({
        apiUrl: agentWithEndpoint.endpoint.deploymentUrl,
        apiKey: agentWithEndpoint.endpoint.langsmithApiKey,
        defaultHeaders: { ...propertyHeaders },
      });
      let state: any = {};
      try {
        state = (await client.threads.getState(threadId)).values as any;
      } catch (error) {}

      if (Object.keys(state).length === 0) {
        return {
          threadId: threadId || "",
          threadExists: false,
          state: JSON.stringify({}),
          messages: JSON.stringify([]),
        };
      } else {
        const { messages, ...stateWithoutMessages } = state;
        const copilotkitMessages = langchainMessagesToCopilotKit(messages);
        return {
          threadId: threadId || "",
          threadExists: true,
          state: JSON.stringify(stateWithoutMessages),
          messages: JSON.stringify(copilotkitMessages),
        };
      }
    } else if (
      agentWithEndpoint.endpoint.type === EndpointType.CopilotKit ||
      !("type" in agentWithEndpoint.endpoint)
    ) {
      const cpkEndpoint = agentWithEndpoint.endpoint as CopilotKitEndpoint;
      const fetchUrl = `${cpkEndpoint.url}/agents/state`;
      try {
        const response = await fetch(fetchUrl, {
          method: "POST",
          headers: createHeaders(cpkEndpoint.onBeforeRequest, graphqlContext),
          body: JSON.stringify({
            properties: graphqlContext.properties,
            threadId,
            name: agentName,
          }),
        });
        if (!response.ok) {
          if (response.status === 404) {
            throw new CopilotKitApiDiscoveryError({ url: fetchUrl });
          }
          throw new ResolvedCopilotKitError({
            status: response.status,
            url: fetchUrl,
            isRemoteEndpoint: true,
          });
        }

        const data: LoadAgentStateResponse = await response.json();

        return {
          ...data,
          state: JSON.stringify(data.state),
          messages: JSON.stringify(data.messages),
        };
      } catch (error) {
        if (error instanceof CopilotKitError) {
          throw error;
        }
        throw new CopilotKitLowLevelError({ error, url: fetchUrl });
      }
    } else {
      throw new Error(`Unknown endpoint type: ${(agentWithEndpoint.endpoint as any).type}`);
    }
  }

  private async processAgentRequest(
    request: CopilotRuntimeRequest,
  ): Promise<CopilotRuntimeResponse> {
    const {
      messages: rawMessages,
      outputMessagesPromise,
      graphqlContext,
      agentSession,
      threadId: threadIdFromRequest,
      metaEvents,
      publicApiKey,
      forwardedParameters,
    } = request;
    const { agentName, nodeName } = agentSession;

    // Track request start time for observability
    const requestStartTime = Date.now();
    // For storing streamed chunks if progressive logging is enabled
    const streamedChunks: any[] = [];

    // for backwards compatibility, deal with the case when no threadId is provided
    const threadId = threadIdFromRequest ?? agentSession.threadId;

    const serverSideActions = await this.getServerSideActions(request);

    const messages = convertGqlInputToMessages(rawMessages);

    const currentAgent = serverSideActions.find(
      (action) => action.name === agentName && isRemoteAgentAction(action),
    ) as RemoteAgentAction;

    if (!currentAgent) {
      throw new CopilotKitAgentDiscoveryError({ agentName });
    }

    // Filter actions to include:
    // 1. Regular (non-agent) actions
    // 2. Other agents' actions (but prevent self-calls to avoid infinite loops)
    const availableActionsForCurrentAgent: ActionInput[] = serverSideActions
      .filter(
        (action) =>
          // Case 1: Keep all regular (non-agent) actions
          !isRemoteAgentAction(action) ||
          // Case 2: For agent actions, keep all except self (prevent infinite loops)
          (isRemoteAgentAction(action) && action.name !== agentName) /* prevent self-calls */,
      )
      .map((action) => ({
        name: action.name,
        description: action.description,
        jsonSchema: JSON.stringify(actionParametersToJsonSchema(action.parameters)),
      }));

    const allAvailableActions = flattenToolCallsNoDuplicates([
      ...availableActionsForCurrentAgent,
      ...request.actions,
    ]);

    // Log agent request if observability is enabled
    if (this.observability?.enabled && publicApiKey) {
      try {
        const requestData: LLMRequestData = {
          threadId,
          runId: undefined,
          model: forwardedParameters?.model,
          messages,
          actions: allAvailableActions,
          forwardedParameters,
          timestamp: requestStartTime,
          provider: "agent",
          agentName, // Add agent-specific context
          nodeName,
        };

        await this.observability.hooks.handleRequest(requestData);
      } catch (error) {
        console.error("Error logging agent request:", error);
      }
    }

    await this.onBeforeRequest?.({
      threadId,
      runId: undefined,
      inputMessages: messages,
      properties: graphqlContext.properties,
    });

    try {
      const eventSource = new RuntimeEventSource();
      const stream = await currentAgent.remoteAgentHandler({
        name: agentName,
        threadId,
        nodeName,
        metaEvents,
        actionInputsWithoutAgents: allAvailableActions,
      });

      // Add progressive observability if enabled
      if (this.observability?.enabled && this.observability.progressive && publicApiKey) {
        // Wrap the stream function to intercept events for observability without changing core logic
        const originalStream = eventSource.stream.bind(eventSource);

        eventSource.stream = async (callback) => {
          await originalStream(async (eventStream$) => {
            // Create subscription to capture streaming events
            eventStream$.subscribe({
              next: (event) => {
                // Only log content chunks
                if (event.type === RuntimeEventTypes.TextMessageContent) {
                  // Store the chunk
                  streamedChunks.push(event.content);

                  // Log each chunk separately for progressive mode
                  try {
                    const progressiveData: LLMResponseData = {
                      threadId: threadId || "",
                      runId: undefined,
                      model: forwardedParameters?.model,
                      output: event.content,
                      latency: Date.now() - requestStartTime,
                      timestamp: Date.now(),
                      provider: "agent",
                      isProgressiveChunk: true,
                      agentName,
                      nodeName,
                    };

                    // Use Promise to handle async logger without awaiting
                    Promise.resolve()
                      .then(() => {
                        this.observability.hooks.handleResponse(progressiveData);
                      })
                      .catch((error) => {
                        console.error("Error in progressive agent logging:", error);
                      });
                  } catch (error) {
                    console.error("Error preparing progressive agent log data:", error);
                  }
                }
              },
            });

            // Call the original callback with the event stream
            await callback(eventStream$);
          });
        };
      }

      eventSource.stream(async (eventStream$) => {
        from(stream).subscribe({
          next: (event) => eventStream$.next(event),
          error: (err) => {
            console.error("Error in stream", err);

            // Log error with observability if enabled
            if (this.observability?.enabled && publicApiKey) {
              try {
                const errorData: LLMErrorData = {
                  threadId,
                  runId: undefined,
                  model: forwardedParameters?.model,
                  error: err instanceof Error ? err : String(err),
                  timestamp: Date.now(),
                  latency: Date.now() - requestStartTime,
                  provider: "agent",
                  agentName,
                  nodeName,
                };

                this.observability.hooks.handleError(errorData);
              } catch (logError) {
                console.error("Error logging agent error:", logError);
              }
            }

            eventStream$.error(err);
            eventStream$.complete();
          },
          complete: () => eventStream$.complete(),
        });
      });

      // Log final agent response when outputs are available
      if (this.observability?.enabled && publicApiKey) {
        outputMessagesPromise
          .then((outputMessages) => {
            const responseData: LLMResponseData = {
              threadId,
              runId: undefined,
              model: forwardedParameters?.model,
              // Use collected chunks for progressive mode or outputMessages for regular mode
              output: this.observability.progressive ? streamedChunks : outputMessages,
              latency: Date.now() - requestStartTime,
              timestamp: Date.now(),
              provider: "agent",
              isFinalResponse: true,
              agentName,
              nodeName,
            };

            try {
              this.observability.hooks.handleResponse(responseData);
            } catch (logError) {
              console.error("Error logging agent response:", logError);
            }
          })
          .catch((error) => {
            console.error("Failed to get output messages for agent logging:", error);
          });
      }

      outputMessagesPromise
        .then((outputMessages) => {
          this.onAfterRequest?.({
            threadId,
            runId: undefined,
            inputMessages: messages,
            outputMessages,
            properties: graphqlContext.properties,
          });
        })
        .catch((_error) => {});

      return {
        threadId,
        runId: undefined,
        eventSource,
        serverSideActions,
        actionInputsWithoutAgents: allAvailableActions,
      };
    } catch (error) {
      // Log error with observability if enabled
      if (this.observability?.enabled && publicApiKey) {
        try {
          const errorData: LLMErrorData = {
            threadId,
            runId: undefined,
            model: forwardedParameters?.model,
            error: error instanceof Error ? error : String(error),
            timestamp: Date.now(),
            latency: Date.now() - requestStartTime,
            provider: "agent",
            agentName,
            nodeName,
          };

          await this.observability.hooks.handleError(errorData);
        } catch (logError) {
          console.error("Error logging agent error:", logError);
        }
      }

      console.error("Error getting response:", error);
      throw error;
    }
  }

  private async getServerSideActions(request: CopilotRuntimeRequest): Promise<Action<any>[]> {
    const { messages: rawMessages, graphqlContext, agentStates, url } = request;
    const inputMessages = convertGqlInputToMessages(rawMessages);
    const langserveFunctions: Action<any>[] = [];

    for (const chainPromise of this.langserve) {
      try {
        const chain = await chainPromise;
        langserveFunctions.push(chain);
      } catch (error) {
        console.error("Error loading langserve chain:", error);
      }
    }

    const remoteEndpointDefinitions = this.remoteEndpointDefinitions.map(
      (endpoint) =>
        ({
          ...endpoint,
          type: resolveEndpointType(endpoint),
        }) as EndpointDefinition,
    );

    const remoteActions = await setupRemoteActions({
      remoteEndpointDefinitions,
      graphqlContext,
      messages: inputMessages,
      agentStates,
      frontendUrl: url,
    });

    const configuredActions =
      typeof this.actions === "function"
        ? this.actions({ properties: graphqlContext.properties, url })
        : this.actions;

    return [...configuredActions, ...langserveFunctions, ...remoteActions];
  }

  // Add helper method to detect provider
  private detectProvider(serviceAdapter: CopilotServiceAdapter): string | undefined {
    const adapterName = serviceAdapter.constructor.name;
    if (adapterName.includes("OpenAI")) return "openai";
    if (adapterName.includes("Anthropic")) return "anthropic";
    if (adapterName.includes("Google")) return "google";
    if (adapterName.includes("Groq")) return "groq";
    if (adapterName.includes("LangChain")) return "langchain";
    return undefined;
  }
}

export function flattenToolCallsNoDuplicates(toolsByPriority: ActionInput[]): ActionInput[] {
  let allTools: ActionInput[] = [];
  const allToolNames: string[] = [];
  for (const tool of toolsByPriority) {
    if (!allToolNames.includes(tool.name)) {
      allTools.push(tool);
      allToolNames.push(tool.name);
    }
  }
  return allTools;
}

// The two functions below are "factory functions", meant to create the action objects that adhere to the expected interfaces
export function copilotKitEndpoint(config: Omit<CopilotKitEndpoint, "type">): CopilotKitEndpoint {
  return {
    ...config,
    type: EndpointType.CopilotKit,
  };
}

export function langGraphPlatformEndpoint(
  config: Omit<LangGraphPlatformEndpoint, "type">,
): LangGraphPlatformEndpoint {
  return {
    ...config,
    type: EndpointType.LangGraphPlatform,
  };
}

export function resolveEndpointType(endpoint: EndpointDefinition) {
  if (!endpoint.type) {
    if ("deploymentUrl" in endpoint && "agents" in endpoint) {
      return EndpointType.LangGraphPlatform;
    } else {
      return EndpointType.CopilotKit;
    }
  }

  return endpoint.type;
}
