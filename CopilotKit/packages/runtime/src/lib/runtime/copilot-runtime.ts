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
  CopilotKitAgentDiscoveryError,
  CopilotKitMisuseError,
  CopilotKitErrorCode,
  CopilotKitLowLevelError,
  CopilotErrorHandler,
  CopilotErrorEvent,
  CopilotRequestContext,
  ensureStructuredError,
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
import { fetchWithRetry } from "./retry-utils";
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
import { AbstractAgent } from "@ag-ui/client";
import { MessageRole } from "../../graphql/types/enums";

// +++ MCP Imports +++
import {
  MCPClient,
  MCPEndpointConfig,
  MCPTool,
  convertMCPToolsToActions,
  generateMcpToolInstructions,
} from "./mcp-tools-utils";
import { LangGraphAgent } from "./langgraph/langgraph-agent";
// Define the function type alias here or import if defined elsewhere
type CreateMCPClientFunction = (config: MCPEndpointConfig) => Promise<MCPClient>;
// --- MCP Imports ---

import { generateHelpfulErrorMessage } from "../streaming";

export interface CopilotRuntimeRequest {
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
   * A map of agent names to AGUI agents.
   * Example agent config:
   * ```ts
   * import { AbstractAgent } from "@ag-ui/client";
   * // ...
   * agents: {
   *   "support": new CustomerSupportAgent(),
   *   "technical": new TechnicalAgent()
   * }
   * ```
   */
  agents?: Record<string, AbstractAgent>;

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

  /**
   * Configuration for connecting to Model Context Protocol (MCP) servers.
   * Allows fetching and using tools defined on external MCP-compliant servers.
   * Requires providing the `createMCPClient` function during instantiation.
   * @experimental
   */
  mcpServers?: MCPEndpointConfig[];

  /**
   * A function that creates an MCP client instance for a given endpoint configuration.
   * This function is responsible for using the appropriate MCP client library
   * (e.g., `@copilotkit/runtime`, `ai`) to establish a connection.
   * Required if `mcpServers` is provided.
   *
   * ```typescript
   * import { experimental_createMCPClient } from "ai"; // Import from vercel ai library
   * // ...
   * const runtime = new CopilotRuntime({
   *   mcpServers: [{ endpoint: "..." }],
   *   async createMCPClient(config) {
   *     return await experimental_createMCPClient({
   *       transport: {
   *         type: "sse",
   *         url: config.endpoint,
   *         headers: config.apiKey
   *           ? { Authorization: `Bearer ${config.apiKey}` }
   *           : undefined,
   *       },
   *     });
   *   }
   * });
   * ```
   */
  createMCPClient?: CreateMCPClientFunction;

  /**
   * Optional error handler for comprehensive debugging and observability.
   *
   * **Requires publicApiKey**: Error handling only works when requests include a valid publicApiKey.
   * This is a premium Copilot Cloud feature.
   *
   * @param errorEvent - Structured error event with rich debugging context
   *
   * @example
   * ```typescript
   * const runtime = new CopilotRuntime({
   *   onError: (errorEvent) => {
   *     debugDashboard.capture(errorEvent);
   *   }
   * });
   * ```
   */
  onError?: CopilotErrorHandler;
}

export class CopilotRuntime<const T extends Parameter[] | [] = []> {
  public actions: ActionsConfiguration<T>;
  public agents: Record<string, AbstractAgent>;
  public remoteEndpointDefinitions: EndpointDefinition[];
  private langserve: Promise<Action<any>>[] = [];
  private onBeforeRequest?: OnBeforeRequestHandler;
  private onAfterRequest?: OnAfterRequestHandler;
  private delegateAgentProcessingToServiceAdapter: boolean;
  private observability?: CopilotObservabilityConfig;
  private availableAgents: Pick<AgentWithEndpoint, "name" | "id">[];
  private onError?: CopilotErrorHandler;
  private hasWarnedAboutError = false;

  // +++ MCP Properties +++
  private readonly mcpServersConfig?: MCPEndpointConfig[];
  private mcpActionCache = new Map<string, Action<any>[]>();
  // --- MCP Properties ---

  // +++ MCP Client Factory +++
  private readonly createMCPClientImpl?: CreateMCPClientFunction;
  // --- MCP Client Factory ---

  constructor(params?: CopilotRuntimeConstructorParams<T>) {
    if (
      params?.actions &&
      params?.remoteEndpoints &&
      params?.remoteEndpoints.some((e) => e.type === EndpointType.LangGraphPlatform)
    ) {
      console.warn("Actions set in runtime instance will not be available for the agent");
      console.warn(
        `LangGraph Platform remote endpoints are deprecated in favor of the "agents" property`,
      );
    }

    // TODO: finalize
    // if (
    //   params?.agents &&
    //   Object.values(params.agents).some((agent) => {
    //     return agent instanceof AguiLangGraphAgent && !(agent instanceof LangGraphAgent);
    //   })
    // ) {
    //   console.warn('LangGraph Agent class should be imported from @copilotkit/runtime. ')
    // }

    this.actions = params?.actions || [];
    this.availableAgents = [];

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
    this.agents = params?.agents ?? {};
    this.onError = params?.onError;
    // +++ MCP Initialization +++
    this.mcpServersConfig = params?.mcpServers;
    this.createMCPClientImpl = params?.createMCPClient;

    // Validate: If mcpServers are provided, createMCPClient must also be provided
    if (this.mcpServersConfig && this.mcpServersConfig.length > 0 && !this.createMCPClientImpl) {
      throw new CopilotKitMisuseError({
        message:
          "MCP Integration Error: `mcpServers` were provided, but the `createMCPClient` function was not passed to the CopilotRuntime constructor. " +
          "Please provide an implementation for `createMCPClient`.",
      });
    }

    // Warning if actions are defined alongside LangGraph platform (potentially MCP too?)
    if (
      params?.actions &&
      (params?.remoteEndpoints?.some((e) => e.type === EndpointType.LangGraphPlatform) ||
        this.mcpServersConfig?.length)
    ) {
      console.warn(
        "Local 'actions' defined in CopilotRuntime might not be available to remote agents (LangGraph, MCP). Consider defining actions closer to the agent implementation if needed.",
      );
    }
  }

  // +++ MCP Instruction Injection Method +++
  private injectMCPToolInstructions(
    messages: MessageInput[],
    currentActions: Action<any>[],
  ): MessageInput[] {
    // Filter the *passed-in* actions for MCP tools
    const mcpActionsForRequest = currentActions.filter((action) => (action as any)._isMCPTool);

    if (!mcpActionsForRequest || mcpActionsForRequest.length === 0) {
      return messages; // No MCP tools for this specific request
    }

    // Create a map to deduplicate tools by name (keeping the last one if duplicates exist)
    const uniqueMcpTools = new Map<string, Action<any>>();

    // Add all MCP tools to the map with their names as keys
    mcpActionsForRequest.forEach((action) => {
      uniqueMcpTools.set(action.name, action);
    });

    // Format instructions from the unique tools map
    // Convert Action objects to MCPTool format for the instruction generator
    const toolsMap: Record<string, MCPTool> = {};
    Array.from(uniqueMcpTools.values()).forEach((action) => {
      toolsMap[action.name] = {
        description: action.description || "",
        schema: action.parameters
          ? {
              parameters: {
                properties: action.parameters.reduce(
                  (acc, p) => ({
                    ...acc,
                    [p.name]: { type: p.type, description: p.description },
                  }),
                  {},
                ),
                required: action.parameters.filter((p) => p.required).map((p) => p.name),
              },
            }
          : {},
        execute: async () => ({}), // Placeholder, not used for instructions
      };
    });

    // Generate instructions using the exported helper
    const mcpToolInstructions = generateMcpToolInstructions(toolsMap);

    if (!mcpToolInstructions) {
      return messages; // No MCP tools to describe
    }

    const instructions =
      mcpToolInstructions + "\nUse them when appropriate to fulfill the user's request.";

    const systemMessageIndex = messages.findIndex((msg) => msg.textMessage?.role === "system");

    const newMessages = [...messages]; // Create a mutable copy

    if (systemMessageIndex !== -1) {
      const existingMsg = newMessages[systemMessageIndex];
      if (existingMsg.textMessage) {
        existingMsg.textMessage.content =
          (existingMsg.textMessage.content ? existingMsg.textMessage.content + "\n\n" : "") +
          instructions;
      }
    } else {
      newMessages.unshift({
        id: randomId(),
        createdAt: new Date(),
        textMessage: {
          role: MessageRole.system,
          content: instructions,
        },
        actionExecutionMessage: undefined,
        resultMessage: undefined,
        agentStateMessage: undefined,
      });
    }

    return newMessages;
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

    const eventSource = new RuntimeEventSource({
      errorHandler: async (error, context) => {
        await this.error("error", context, error, publicApiKey);
      },
      errorContext: {
        threadId,
        runId,
        source: "runtime",
        request: {
          operation: "processRuntimeRequest",
          method: "POST",
          url: url,
          startTime: Date.now(),
        },
        agent: agentSession ? { name: agentSession.agentName } : undefined,
        technical: {
          environment: process.env.NODE_ENV,
        },
      },
    });
    // Track request start time for logging
    const requestStartTime = Date.now();
    // For storing streamed chunks if progressive logging is enabled
    const streamedChunks: any[] = [];

    try {
      if (
        Object.keys(this.agents).length &&
        agentSession?.agentName &&
        !this.delegateAgentProcessingToServiceAdapter
      ) {
        this.agents = { [agentSession.agentName]: this.agents[agentSession.agentName] };
      }

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

      // +++ Get Server Side Actions (including dynamic MCP) EARLY +++
      const serverSideActions = await this.getServerSideActions(request);
      // --- Get Server Side Actions (including dynamic MCP) EARLY ---

      // Filter raw messages *before* injection
      const filteredRawMessages = rawMessages.filter((message) => !message.agentStateMessage);

      // +++ Inject MCP Instructions based on current actions +++
      const messagesWithInjectedInstructions = this.injectMCPToolInstructions(
        filteredRawMessages,
        serverSideActions,
      );
      const inputMessages = convertGqlInputToMessages(messagesWithInjectedInstructions);
      // --- Inject MCP Instructions based on current actions ---

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

      let structuredError: CopilotKitError;

      if (error instanceof CopilotKitError) {
        structuredError = error;
      } else {
        // Convert non-CopilotKitErrors to structured errors, but preserve already structured ones
        structuredError = ensureStructuredError(error, (err) =>
          this.convertStreamingErrorToStructured(err),
        );
      }

      // Track the error
      await this.error(
        "error",
        {
          threadId,
          runId,
          source: "runtime",
          request: {
            operation: "processRuntimeRequest",
            method: "POST",
            url: url,
            startTime: requestStartTime,
          },
          response: {
            endTime: Date.now(),
            latency: Date.now() - requestStartTime,
          },
          agent: agentSession ? { name: agentSession.agentName } : undefined,
          technical: {
            environment: process.env.NODE_ENV,
            stackTrace: error instanceof Error ? error.stack : undefined,
          },
        },
        structuredError,
        publicApiKey,
      );

      throw structuredError;
    }
  }

  async getAllAgents(graphqlContext: GraphQLContext): Promise<(AgentWithEndpoint | Agent)[]> {
    const agentsWithEndpoints = await this.discoverAgentsFromEndpoints(graphqlContext);
    const aguiAgents = this.discoverAgentsFromAgui();

    this.availableAgents = [...agentsWithEndpoints, ...aguiAgents].map((a) => ({
      name: a.name,
      id: a.id,
    }));

    return [...agentsWithEndpoints, ...aguiAgents];
  }

  async discoverAgentsFromEndpoints(graphqlContext: GraphQLContext): Promise<AgentWithEndpoint[]> {
    const agents: Promise<AgentWithEndpoint[]> = this.remoteEndpointDefinitions.reduce(
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
          let data: Array<{ assistant_id: string; graph_id: string }> | { detail: string } = [];
          try {
            data = await client.assistants.search();

            if (data && "detail" in data && (data.detail as string).toLowerCase() === "not found") {
              throw new CopilotKitAgentDiscoveryError({ availableAgents: this.availableAgents });
            }
          } catch (e) {
            throw new CopilotKitMisuseError({
              message: `
              Failed to find or contact remote endpoint at url ${endpoint.deploymentUrl}.
              Make sure the API is running and that it's indeed a LangGraph platform url.
              
              See more: https://docs.copilotkit.ai/troubleshooting/common-issues`,
            });
          }
          const endpointAgents = data.map((entry) => ({
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
          const response = await fetchWithRetry(fetchUrl, {
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

  discoverAgentsFromAgui(): Agent[] {
    return Object.entries(this.agents ?? []).map(([key, agent]: [string, AbstractAgent]) => ({
      name: (agent as any).agentName ?? key,
      id: agent.agentId ?? key,
      description: agent.description ?? "",
    }));
  }

  async loadAgentState(
    graphqlContext: GraphQLContext,
    threadId: string,
    agentName: string,
  ): Promise<LoadAgentStateResponse> {
    const agents = await this.getAllAgents(graphqlContext);

    const agent = agents.find((agent) => agent.name === agentName);
    if (!agent) {
      throw new Error("Agent not found");
    }

    if (
      "endpoint" in agent &&
      (agent.endpoint.type === EndpointType.CopilotKit || !("type" in agent.endpoint))
    ) {
      const cpkEndpoint = agent.endpoint as CopilotKitEndpoint;
      const fetchUrl = `${cpkEndpoint.url}/agents/state`;
      try {
        const response = await fetchWithRetry(fetchUrl, {
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

          // Extract semantic error information from response body
          let errorMessage = `HTTP ${response.status} error`;
          try {
            const errorBody = await response.text();
            const parsedError = JSON.parse(errorBody);
            if (parsedError.error && typeof parsedError.error === "string") {
              errorMessage = parsedError.error;
            }
          } catch {
            // If parsing fails, fall back to generic message
          }

          throw new ResolvedCopilotKitError({
            status: response.status,
            url: fetchUrl,
            isRemoteEndpoint: true,
            message: errorMessage,
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
    }

    const propertyHeaders = graphqlContext.properties.authorization
      ? { authorization: `Bearer ${graphqlContext.properties.authorization}` }
      : null;

    let state: any = {};
    try {
      let client: LangGraphClient | null;
      if ("endpoint" in agent && agent.endpoint.type === EndpointType.LangGraphPlatform) {
        client = new LangGraphClient({
          apiUrl: agent.endpoint.deploymentUrl,
          apiKey: agent.endpoint.langsmithApiKey,
          defaultHeaders: { ...propertyHeaders },
        });
      } else {
        const aguiAgent = graphqlContext._copilotkit.runtime.agents[agent.name] as LangGraphAgent;
        if (!aguiAgent) {
          throw new Error(`Agent: ${agent.name} could not be resolved`);
        }
        // @ts-expect-error -- both clients are the same
        client = aguiAgent.client ?? null;
      }

      state = client ? ((await client.threads.getState(threadId)).values as any) : {};
    } catch (error) {
      // All errors from agent state loading are user configuration issues
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStatus = error?.response?.status || error?.status;

      if (errorStatus === 404) {
        state = {};
      } else {
        // Log user configuration errors at debug level to reduce noise
        console.debug(`Agent '${agentName}' configuration issue: ${errorMessage}`);

        // Throw a configuration error - all agent state loading failures are user setup issues
        throw new ResolvedCopilotKitError({
          status: 400,
          message: `Agent '${agentName}' failed to execute: ${errorMessage}`,
          code: CopilotKitErrorCode.CONFIGURATION_ERROR,
        });
      }
    }

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

    throw new Error(`Agent: ${agent.name} could not be resolved`);
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

    // Track agent request start
    await this.error(
      "agent_state",
      {
        threadId,
        source: "agent",
        request: {
          operation: "processAgentRequest",
          method: "POST",
          startTime: requestStartTime,
        },
        agent: {
          name: agentName,
          nodeName: nodeName,
        },
        messages: {
          input: rawMessages,
          messageCount: rawMessages.length,
        },
        technical: {
          environment: process.env.NODE_ENV,
        },
      },
      undefined,
      publicApiKey,
    );

    const serverSideActions = await this.getServerSideActions(request);

    const messages = convertGqlInputToMessages(rawMessages);

    const currentAgent = serverSideActions.find(
      (action) => action.name === agentName && isRemoteAgentAction(action),
    ) as RemoteAgentAction;

    if (!currentAgent) {
      throw new CopilotKitAgentDiscoveryError({ agentName, availableAgents: this.availableAgents });
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
      const eventSource = new RuntimeEventSource({
        errorHandler: async (error, context) => {
          await this.error("error", context, error, publicApiKey);
        },
        errorContext: {
          threadId,
          source: "agent",
          request: {
            operation: "processAgentRequest",
            method: "POST",
            startTime: requestStartTime,
          },
          agent: {
            name: agentName,
            nodeName: nodeName,
          },
          technical: {
            environment: process.env.NODE_ENV,
          },
        },
      });
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
          error: async (err) => {
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

            // Preserve structured CopilotKit errors, only convert unstructured errors
            const structuredError = ensureStructuredError(err, (error) =>
              this.convertStreamingErrorToStructured(error),
            );

            // Track streaming errors
            await this.error(
              "error",
              {
                threadId,
                source: "agent",
                request: {
                  operation: "processAgentRequest",
                  method: "POST",
                  startTime: requestStartTime,
                },
                response: {
                  endTime: Date.now(),
                  latency: Date.now() - requestStartTime,
                },
                agent: {
                  name: agentName,
                  nodeName: nodeName,
                },
                technical: {
                  environment: process.env.NODE_ENV,
                  stackTrace: err instanceof Error ? err.stack : undefined,
                },
              },
              structuredError,
              publicApiKey,
            );

            eventStream$.error(structuredError);
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

      // Ensure error is structured
      const structuredError = ensureStructuredError(error, (err) =>
        this.convertStreamingErrorToStructured(err),
      );

      // Track the agent error
      await this.error(
        "error",
        {
          threadId,
          source: "agent",
          request: {
            operation: "processAgentRequest",
            method: "POST",
            startTime: requestStartTime,
          },
          response: {
            endTime: Date.now(),
            latency: Date.now() - requestStartTime,
          },
          agent: {
            name: agentName,
            nodeName: nodeName,
          },
          technical: {
            environment: process.env.NODE_ENV,
            stackTrace: error instanceof Error ? error.stack : undefined,
          },
        },
        structuredError,
        publicApiKey,
      );

      console.error("Error getting response:", error);
      throw structuredError;
    }
  }

  private async getServerSideActions(request: CopilotRuntimeRequest): Promise<Action<any>[]> {
    const { graphqlContext, messages: rawMessages, agentStates, url } = request;

    // --- Standard Action Fetching (unchanged) ---
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
      (endpoint) => ({ ...endpoint, type: resolveEndpointType(endpoint) }) as EndpointDefinition,
    );

    const remoteActions = await setupRemoteActions({
      remoteEndpointDefinitions,
      graphqlContext,
      messages: inputMessages,
      agentStates,
      frontendUrl: url,
      agents: this.agents,
      metaEvents: request.metaEvents,
      nodeName: request.agentSession?.nodeName,
    });

    const configuredActions =
      typeof this.actions === "function"
        ? this.actions({ properties: graphqlContext.properties, url })
        : this.actions;
    // --- Standard Action Fetching (unchanged) ---

    // +++ Dynamic MCP Action Fetching +++
    const requestSpecificMCPActions: Action<any>[] = [];
    if (this.createMCPClientImpl) {
      // 1. Determine effective MCP endpoints for this request
      const baseEndpoints = this.mcpServersConfig || [];
      // Assuming frontend passes config via properties.mcpServers
      const requestEndpoints = (graphqlContext.properties?.mcpServers ||
        graphqlContext.properties?.mcpEndpoints ||
        []) as MCPEndpointConfig[];

      // Merge and deduplicate endpoints based on URL
      const effectiveEndpointsMap = new Map<string, MCPEndpointConfig>();

      // First add base endpoints (from runtime configuration)
      [...baseEndpoints].forEach((ep) => {
        if (ep && ep.endpoint) {
          effectiveEndpointsMap.set(ep.endpoint, ep);
        }
      });

      // Then add request endpoints (from frontend), which will override duplicates
      [...requestEndpoints].forEach((ep) => {
        if (ep && ep.endpoint) {
          effectiveEndpointsMap.set(ep.endpoint, ep);
        }
      });

      const effectiveEndpoints = Array.from(effectiveEndpointsMap.values());

      // 2. Fetch/Cache actions for effective endpoints
      for (const config of effectiveEndpoints) {
        const endpointUrl = config.endpoint;
        let actionsForEndpoint: Action<any>[] | undefined = this.mcpActionCache.get(endpointUrl);

        if (!actionsForEndpoint) {
          // Not cached, fetch now
          let client: MCPClient | null = null;
          try {
            client = await this.createMCPClientImpl(config);
            const tools = await client.tools();
            actionsForEndpoint = convertMCPToolsToActions(tools, endpointUrl);
            this.mcpActionCache.set(endpointUrl, actionsForEndpoint); // Store in cache
          } catch (error) {
            console.error(
              `MCP: Failed to fetch tools from endpoint ${endpointUrl}. Skipping. Error:`,
              error,
            );
            actionsForEndpoint = []; // Assign empty array on error to prevent re-fetching constantly
            this.mcpActionCache.set(endpointUrl, actionsForEndpoint); // Cache the failure (empty array)
          }
        }
        requestSpecificMCPActions.push(...(actionsForEndpoint || []));
      }
    }
    // --- Dynamic MCP Action Fetching ---

    // Combine all action sources, including the dynamically fetched MCP actions
    return [
      ...configuredActions,
      ...langserveFunctions,
      ...remoteActions,
      ...requestSpecificMCPActions,
    ];
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

  private convertStreamingErrorToStructured(error: any): CopilotKitError {
    // Determine a more helpful error message based on context
    let helpfulMessage = generateHelpfulErrorMessage(error, "agent streaming connection");

    // For network-related errors, use CopilotKitLowLevelError to preserve the original error
    if (
      error?.message?.includes("fetch failed") ||
      error?.message?.includes("ECONNREFUSED") ||
      error?.message?.includes("ENOTFOUND") ||
      error?.message?.includes("ETIMEDOUT") ||
      error?.message?.includes("terminated") ||
      error?.cause?.code === "UND_ERR_SOCKET" ||
      error?.message?.includes("other side closed") ||
      error?.code === "UND_ERR_SOCKET"
    ) {
      return new CopilotKitLowLevelError({
        error: error instanceof Error ? error : new Error(String(error)),
        url: "agent streaming connection",
        message: helpfulMessage,
      });
    }

    // For all other errors, preserve the raw error in a basic CopilotKitError
    return new CopilotKitError({
      message: helpfulMessage,
      code: CopilotKitErrorCode.UNKNOWN,
    });
  }

  private async error(
    type: CopilotErrorEvent["type"],
    context: CopilotRequestContext,
    error?: any,
    publicApiKey?: string,
  ): Promise<void> {
    if (!this.onError) return;

    // Just check if publicApiKey is defined (regardless of validity)
    if (!publicApiKey) {
      if (!this.hasWarnedAboutError) {
        console.warn(
          "CopilotKit: onError handler provided but requires publicApiKey to be defined for error handling to work.",
        );
        this.hasWarnedAboutError = true;
      }
      return;
    }

    try {
      const errorEvent: CopilotErrorEvent = {
        type,
        timestamp: Date.now(),
        context,
        ...(error && { error }),
      };

      await this.onError(errorEvent);
    } catch (errorHandlerError) {
      // Don't let error handler errors break the main flow
      console.error("Error in onError handler:", errorHandlerError);
    }
  }

  /**
   * Public method to handle GraphQL validation errors
   * This allows the GraphQL resolver to send validation errors through the error system
   */
  public async errorGraphQLError(
    error: { message: string; code: string; type: string },
    context: {
      operation: string;
      cloudConfigPresent: boolean;
      guardrailsEnabled: boolean;
    },
  ): Promise<void> {
    if (!this.onError) return;

    try {
      await this.onError({
        type: "error",
        timestamp: Date.now(),
        context: {
          source: "runtime",
          request: {
            operation: context.operation,
            startTime: Date.now(),
          },
          technical: {
            environment: process.env.NODE_ENV,
          },
          metadata: {
            errorType: "GraphQLValidationError",
            cloudConfigPresent: context.cloudConfigPresent,
            guardrailsEnabled: context.guardrailsEnabled,
          },
        },
        error,
      });
    } catch (errorHandlerError) {
      // Don't let error handler errors break the main flow
      console.error("Error in onError handler:", errorHandlerError);
    }
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
