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
  CopilotErrorHandler,
  CopilotKitMisuseError,
  MaybePromise,
  NonEmptyRecord,
  Parameter,
  readBody,
  getZodParameters,
  PartialBy,
} from "@copilotkit/shared";
import { type RunAgentInput } from "@ag-ui/core";
import { aguiToGQL } from "../../graphql/message-conversion/agui-to-gql";
import { CopilotServiceAdapter, RemoteChainParameters } from "../../service-adapters";
import {
  CopilotRuntime as CopilotRuntimeVNext,
  CopilotRuntimeOptions,
  CopilotRuntimeOptions as CopilotRuntimeOptionsVNext,
  InMemoryAgentRunner as InMemoryAgentRunnerVNext,
} from "@copilotkitnext/runtime";

import { MessageInput } from "../../graphql/inputs/message.input";
import { ActionInput } from "../../graphql/inputs/action.input";
import { RuntimeEventSource } from "../../service-adapters/events";
import { Message } from "../../graphql/types/converted";
import { ForwardedParametersInput } from "../../graphql/inputs/forwarded-parameters.input";

import {
  EndpointType,
  EndpointDefinition,
  CopilotKitEndpoint,
  LangGraphPlatformEndpoint,
} from "./types";

import { GraphQLContext } from "../integrations/shared";
import { AgentSessionInput } from "../../graphql/inputs/agent-session.input";
import { AgentStateInput } from "../../graphql/inputs/agent-state.input";
import { Agent } from "../../graphql/types/agents-response.type";
import { ExtensionsInput } from "../../graphql/inputs/extensions.input";
import { ExtensionsResponse } from "../../graphql/types/extensions-response.type";
import { MetaEventInput } from "../../graphql/inputs/meta-event.input";
import {
  CopilotObservabilityConfig,
  LLMRequestData,
  LLMResponseData,
  LLMErrorData,
} from "../observability";
import { AbstractAgent } from "@ag-ui/client";

// +++ MCP Imports +++
import {
  MCPClient,
  MCPEndpointConfig,
  MCPTool,
  extractParametersFromSchema,
  convertMCPToolsToActions,
  generateMcpToolInstructions,
} from "./mcp-tools-utils";
import { LangGraphAgent } from "./agent-integrations/langgraph.agent";
// Define the function type alias here or import if defined elsewhere
type CreateMCPClientFunction = (config: MCPEndpointConfig) => Promise<MCPClient>;
// --- MCP Imports ---

import { CopilotContextInput } from "../../graphql/inputs/copilot-context.input";
import { BasicAgent, BasicAgentConfiguration } from "@copilotkitnext/agent";

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in (value as object) &&
    typeof (value as { then: unknown }).then === "function"
  );
}

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
  context?: CopilotContextInput[];
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

interface OnStopGenerationOptions {
  threadId: string;
  runId?: string;
  url?: string;
  agentName?: string;
  lastMessage: MessageInput;
}
type OnStopGenerationHandler = (options: OnStopGenerationOptions) => void | Promise<void>;

interface Middleware {
  /**
   * A function that is called before the request is processed.
   */
  /**
   * @deprecated This middleware hook is deprecated and will be removed in a future version.
   * Use updated middleware integration methods in CopilotRuntimeVNext instead.
   */
  onBeforeRequest?: OnBeforeRequestHandler;

  /**
   * A function that is called after the request is processed.
   */
  /**
   * @deprecated This middleware hook is deprecated and will be removed in a future version.
   * Use updated middleware integration methods in CopilotRuntimeVNext instead.
   */
  onAfterRequest?: OnAfterRequestHandler;
}

type AgentWithEndpoint = Agent & { endpoint: EndpointDefinition };

export interface CopilotRuntimeConstructorParams_BASE<T extends Parameter[] | [] = []> {
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
  /**
   * @deprecated This middleware hook is deprecated and will be removed in a future version.
   * Use updated middleware integration methods in CopilotRuntimeVNext instead.
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

  onStopGeneration?: OnStopGenerationHandler;

  // /** Optional transcription service for audio processing. */
  // transcriptionService?: CopilotRuntimeOptionsVNext["transcriptionService"];
  // /** Optional *before* middleware – callback function or webhook URL. */
  // beforeRequestMiddleware?: CopilotRuntimeOptionsVNext["beforeRequestMiddleware"];
  // /** Optional *after* middleware – callback function or webhook URL. */
  // afterRequestMiddleware?: CopilotRuntimeOptionsVNext["afterRequestMiddleware"];
}

// (duplicate BASE interface removed)

type BeforeRequestMiddleware = CopilotRuntimeOptionsVNext["beforeRequestMiddleware"];
type AfterRequestMiddleware = CopilotRuntimeOptionsVNext["afterRequestMiddleware"];
type BeforeRequestMiddlewareFn = Exclude<BeforeRequestMiddleware, string>;
type BeforeRequestMiddlewareFnParameters = Parameters<BeforeRequestMiddlewareFn>;
type BeforeRequestMiddlewareFnResult = ReturnType<BeforeRequestMiddlewareFn>;
type AfterRequestMiddlewareFn = Exclude<AfterRequestMiddleware, string>;
type AfterRequestMiddlewareFnParameters = Parameters<AfterRequestMiddlewareFn>;

interface CopilotRuntimeConstructorParams<T extends Parameter[] | [] = []>
  extends Omit<CopilotRuntimeConstructorParams_BASE<T>, "agents">,
    Omit<CopilotRuntimeOptionsVNext, "agents" | "transcriptionService"> {
  /**
   * TODO: un-omit `transcriptionService` above once it's supported
   *
   * This satisfies...
   *  – the optional constraint in `CopilotRuntimeConstructorParams_BASE`
   *  – the `MaybePromise<NonEmptyRecord<T>>` constraint in `CopilotRuntimeOptionsVNext`
   *  – the `Record<string, AbstractAgent>` constraint in `both
   */
  agents?: MaybePromise<NonEmptyRecord<Record<string, AbstractAgent>>>;
}

/**
 * Central runtime object passed to all request handlers.
 */
export class CopilotRuntime {
  params?: CopilotRuntimeConstructorParams;
  private observability?: CopilotObservabilityConfig;
  // Cache MCP tools per endpoint to avoid re-fetching repeatedly
  private mcpToolsCache: Map<string, BasicAgentConfiguration["tools"]> = new Map();
  private runtimeArgs: CopilotRuntimeOptions;
  private _instance: CopilotRuntimeVNext;

  constructor(
    params?: CopilotRuntimeConstructorParams & PartialBy<CopilotRuntimeOptions, "agents">,
  ) {
    const agents = params?.agents ?? {};
    this.runtimeArgs = {
      agents: { ...this.assignEndpointsToAgents(params?.remoteEndpoints ?? []), ...agents },
      runner: params?.runner ?? new InMemoryAgentRunnerVNext(),
      // TODO: add support for transcriptionService from CopilotRuntimeOptionsVNext once it is ready
      // transcriptionService: params?.transcriptionService,

      beforeRequestMiddleware: this.createOnBeforeRequestHandler(params).bind(this),
      afterRequestMiddleware: this.createOnAfterRequestHandler(params).bind(this),
    };
    this.params = params;
    this.observability = params?.observability_c;
  }

  get instance() {
    if (!this._instance) {
      this._instance = new CopilotRuntimeVNext(this.runtimeArgs);
    }

    return this._instance;
  }

  private assignEndpointsToAgents(endpoints: CopilotRuntimeConstructorParams["remoteEndpoints"]) {
    return endpoints.reduce((acc, endpoint) => {
      if (resolveEndpointType(endpoint) == EndpointType.LangGraphPlatform) {
        let lgAgents = {};
        const lgEndpoint = endpoint as LangGraphPlatformEndpoint;
        lgEndpoint.agents.forEach((agent) => {
          const graphId = agent.assistantId ?? agent.name;
          lgAgents[graphId] = new LangGraphAgent({
            deploymentUrl: lgEndpoint.deploymentUrl,
            langsmithApiKey: lgEndpoint.langsmithApiKey,
            graphId,
          });
        });

        return {
          ...acc,
          ...lgAgents,
        };
      }

      return acc;
    }, {});
  }

  handleServiceAdapter(serviceAdapter: CopilotServiceAdapter) {
    this.runtimeArgs.agents = Promise.resolve(this.runtimeArgs.agents ?? {}).then(
      async (agents) => {
        let agentsList = agents;
        const isAgentsListEmpty = !Object.keys(agents).length;
        const hasServiceAdapter = Boolean(serviceAdapter);
        const illegalServiceAdapterNames = ["EmptyAdapter"];
        const serviceAdapterCanBeUsedForAgent = !illegalServiceAdapterNames.includes(
          serviceAdapter.name,
        );

        if (isAgentsListEmpty && (!hasServiceAdapter || !serviceAdapterCanBeUsedForAgent)) {
          throw new CopilotKitMisuseError({
            message:
              "No default agent provided. Please provide a default agent in the runtime config.",
          });
        }

        if (isAgentsListEmpty) {
          agentsList.default = new BasicAgent({
            model: `${serviceAdapter.provider}/${serviceAdapter.model}`,
          });
        }

        if (this.params.actions?.length) {
          const mcpTools = await this.getToolsFromMCP();
          agentsList = this.assignToolsToAgents(agents, [
            ...this.getToolsFromActions(this.params.actions),
            ...mcpTools,
          ]);
        }

        return agentsList;
      },
    );
  }

  // Receive this.params.action and turn it into the AbstractAgent tools
  private getToolsFromActions(
    actions: ActionsConfiguration<any>,
  ): BasicAgentConfiguration["tools"] {
    // Resolve actions to an array (handle function case)
    const actionsArray =
      typeof actions === "function" ? actions({ properties: {}, url: undefined }) : actions;

    // Convert each Action to a ToolDefinition
    return actionsArray.map((action) => {
      // Convert JSON schema to Zod schema
      const zodSchema = getZodParameters(action.parameters || []);

      return {
        name: action.name,
        description: action.description || "",
        parameters: zodSchema,
      };
    });
  }

  private assignToolsToAgents(
    agents: Record<string, AbstractAgent>,
    tools: BasicAgentConfiguration["tools"],
  ): Record<string, AbstractAgent> {
    if (!tools?.length) {
      return agents;
    }

    const enrichedAgents: Record<string, AbstractAgent> = { ...agents };

    for (const [agentId, agent] of Object.entries(enrichedAgents)) {
      const existingConfig = (Reflect.get(agent, "config") ?? {}) as BasicAgentConfiguration;
      const existingTools = existingConfig.tools ?? [];

      const updatedConfig: BasicAgentConfiguration = {
        ...existingConfig,
        tools: [...existingTools, ...tools],
      };

      Reflect.set(agent, "config", updatedConfig);
      enrichedAgents[agentId] = agent;
    }

    return enrichedAgents;
  }

  private createOnBeforeRequestHandler(
    params?: CopilotRuntimeConstructorParams & PartialBy<CopilotRuntimeOptions, "agents">,
  ) {
    return async (hookParams: BeforeRequestMiddlewareFnParameters[0]) => {
      // TODO: get public api key and run with expected data
      // if (this.observability?.enabled && this.params.publicApiKey) {
      //   this.logObservabilityBeforeRequest()
      // }

      // TODO: replace hooksParams top argument type with BeforeRequestMiddlewareParameters when exported
      params?.beforeRequestMiddleware?.(hookParams);

      if (params?.middleware?.onBeforeRequest) {
        const { request, runtime, path } = hookParams;
        const body = (await readBody(request)) as RunAgentInput;
        const gqlMessages = (aguiToGQL(body.messages) as Message[]).reduce(
          (acc, msg) => {
            if ("role" in msg && msg.role === "user") {
              acc.inputMessages.push(msg);
            } else {
              acc.outputMessages.push(msg);
            }
            return acc;
          },
          { inputMessages: [] as Message[], outputMessages: [] as Message[] },
        );
        const { inputMessages, outputMessages } = gqlMessages;
        params.middleware.onBeforeRequest({
          threadId: body.threadId,
          runId: body.runId,
          inputMessages,
          properties: body.forwardedProps,
          url: request.url,
        } satisfies OnBeforeRequestOptions);
      }
    };
  }

  private createOnAfterRequestHandler(
    params?: CopilotRuntimeConstructorParams & PartialBy<CopilotRuntimeOptions, "agents">,
  ) {
    return async (hookParams: AfterRequestMiddlewareFnParameters[0]) => {
      // TODO: get public api key and run with expected data
      // if (this.observability?.enabled && publicApiKey) {
      //   this.logObservabilityAfterRequest()
      // }

      // TODO: replace hooksParams top argument type with AfterRequestMiddlewareParameters when exported
      params?.afterRequestMiddleware?.(hookParams);

      if (params?.middleware?.onAfterRequest) {
        // TODO: provide old expected params here when available
        // @ts-expect-error -- missing arguments.
        params.middleware.onAfterRequest({});
      }
    };
  }

  // Observability Methods

  /**
   * Log LLM request if observability is enabled
   */
  private async logObservabilityBeforeRequest(requestData: LLMRequestData): Promise<void> {
    try {
      await this.observability.hooks.handleRequest(requestData);
    } catch (error) {
      console.error("Error logging LLM request:", error);
    }
  }

  /**
   * Log final LLM response after request completes
   */
  private logObservabilityAfterRequest(
    outputMessagesPromise: Promise<Message[]>,
    baseData: {
      threadId: string;
      runId?: string;
      model?: string;
      provider?: string;
      agentName?: string;
      nodeName?: string;
    },
    streamedChunks: any[],
    requestStartTime: number,
    publicApiKey?: string,
  ): void {
    try {
      outputMessagesPromise
        .then((outputMessages) => {
          const responseData: LLMResponseData = {
            threadId: baseData.threadId,
            runId: baseData.runId,
            model: baseData.model,
            // Use collected chunks for progressive mode or outputMessages for regular mode
            output: this.observability.progressive ? streamedChunks : outputMessages,
            latency: Date.now() - requestStartTime,
            timestamp: Date.now(),
            provider: baseData.provider,
            isFinalResponse: true,
            agentName: baseData.agentName,
            nodeName: baseData.nodeName,
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

  // Resolve MCP tools to BasicAgent tool definitions
  // Optionally accepts request-scoped properties to merge request-provided mcpServers
  private async getToolsFromMCP(options?: {
    properties?: Record<string, unknown>;
  }): Promise<BasicAgentConfiguration["tools"]> {
    const runtimeMcpServers = (this.params?.mcpServers ?? []) as MCPEndpointConfig[];
    const createMCPClient = this.params?.createMCPClient as CreateMCPClientFunction | undefined;

    // If no runtime config and no request overrides, nothing to do
    const requestMcpServers = ((
      options?.properties as { mcpServers?: MCPEndpointConfig[] } | undefined
    )?.mcpServers ??
      (options?.properties as { mcpEndpoints?: MCPEndpointConfig[] } | undefined)?.mcpEndpoints ??
      []) as MCPEndpointConfig[];

    const hasAnyServers =
      (runtimeMcpServers?.length ?? 0) > 0 || (requestMcpServers?.length ?? 0) > 0;
    if (!hasAnyServers) {
      return [];
    }

    if (!createMCPClient) {
      // Mirror legacy behavior: when servers are provided without a factory, treat as misconfiguration
      throw new CopilotKitMisuseError({
        message:
          "MCP Integration Error: `mcpServers` were provided, but the `createMCPClient` function was not passed to the CopilotRuntime constructor. Please provide an implementation for `createMCPClient`.",
      });
    }

    // Merge and dedupe endpoints by URL; request-level overrides take precedence
    const effectiveEndpoints = (() => {
      const byUrl = new Map<string, MCPEndpointConfig>();
      for (const ep of runtimeMcpServers) {
        if (ep?.endpoint) byUrl.set(ep.endpoint, ep);
      }
      for (const ep of requestMcpServers) {
        if (ep?.endpoint) byUrl.set(ep.endpoint, ep);
      }
      return Array.from(byUrl.values());
    })();

    const allTools: BasicAgentConfiguration["tools"] = [];

    for (const config of effectiveEndpoints) {
      const endpointUrl = config.endpoint;
      // Return cached tool definitions when available
      const cached = this.mcpToolsCache.get(endpointUrl);
      if (cached) {
        allTools.push(...cached);
        continue;
      }

      try {
        const client = await createMCPClient(config);
        const toolsMap = await client.tools();

        const toolDefs: BasicAgentConfiguration["tools"] = Object.entries(toolsMap).map(
          ([toolName, tool]: [string, MCPTool]) => {
            const params: Parameter[] = extractParametersFromSchema(tool);
            const zodSchema = getZodParameters(params);
            return {
              name: toolName,
              description: tool.description || `MCP tool: ${toolName} (from ${endpointUrl})`,
              parameters: zodSchema,
            };
          },
        );

        // Cache per endpoint and add to aggregate
        this.mcpToolsCache.set(endpointUrl, toolDefs);
        allTools.push(...toolDefs);
      } catch (error) {
        console.error(
          `MCP: Failed to fetch tools from endpoint ${endpointUrl}. Skipping. Error:`,
          error,
        );
        // Cache empty to prevent repeated attempts within lifecycle
        this.mcpToolsCache.set(endpointUrl, []);
      }
    }

    // Dedupe tools by name while preserving last-in wins (request overrides)
    const dedupedByName = new Map<string, (typeof allTools)[number]>();
    for (const tool of allTools) {
      dedupedByName.set(tool.name, tool);
    }

    return Array.from(dedupedByName.values());
  }
}

// export class CopilotRuntime<const T extends Parameter[] | [] = []> {
//   public actions: ActionsConfiguration<T>;
//   public agents: Record<string, AbstractAgent>;
//   public remoteEndpointDefinitions: EndpointDefinition[];
//   private langserve: Promise<Action<any>>[] = [];
//   private onBeforeRequest?: OnBeforeRequestHandler;
//   private onAfterRequest?: OnAfterRequestHandler;
//   private onStopGeneration?: OnStopGenerationHandler;
//   private delegateAgentProcessingToServiceAdapter: boolean;
//   private observability?: CopilotObservabilityConfig;
//   private availableAgents: Pick<AgentWithEndpoint, "name" | "id">[];
//   private onError?: CopilotErrorHandler;
//   private hasWarnedAboutError = false;
//
//   // +++ MCP Properties +++
//   private readonly mcpServersConfig?: MCPEndpointConfig[];
//   private mcpActionCache = new Map<string, Action<any>[]>();
//   // --- MCP Properties ---
//
//   // +++ MCP Client Factory +++
//   private readonly createMCPClientImpl?: CreateMCPClientFunction;
//   // --- MCP Client Factory ---
//
//   constructor(params?: CopilotRuntimeConstructorParams<T>) {
//     if (
//       params?.remoteEndpoints &&
//       params?.remoteEndpoints.some((e) => e.type === EndpointType.LangGraphPlatform)
//     ) {
//       throw new CopilotKitMisuseError({
//         message:
//           "LangGraph Platform remote endpoints are deprecated in favor of the `agents` property. Refer to https://docs.copilotkit.ai/langgraph for more information.",
//       });
//     }
//
//     if (
//       params?.actions &&
//       params?.remoteEndpoints &&
//       params?.remoteEndpoints.some((e) => e.type === EndpointType.LangGraphPlatform)
//     ) {
//       console.warn("Actions set in runtime instance will not be available for the agent");
//       console.warn(
//         `LangGraph Platform remote endpoints are deprecated in favor of the "agents" property`,
//       );
//     }
//
//     // TODO: finalize
//     // if (
//     //   params?.agents &&
//     //   Object.values(params.agents).some((agent) => {
//     //     return agent instanceof AguiLangGraphAgent && !(agent instanceof LangGraphAgent);
//     //   })
//     // ) {
//     //   console.warn('LangGraph Agent class should be imported from @copilotkit/runtime. ')
//     // }
//
//     this.actions = params?.actions || [];
//     this.availableAgents = [];
//
//     for (const chain of params?.langserve || []) {
//       const remoteChain = new RemoteChain(chain);
//       this.langserve.push(remoteChain.toAction());
//     }
//
//     this.remoteEndpointDefinitions = params?.remoteEndpoints ?? params?.remoteActions ?? [];
//
//     this.onBeforeRequest = params?.middleware?.onBeforeRequest;
//     this.onAfterRequest = params?.middleware?.onAfterRequest;
//     this.onStopGeneration = params?.onStopGeneration;
//     this.delegateAgentProcessingToServiceAdapter =
//       params?.delegateAgentProcessingToServiceAdapter || false;
//     this.observability = params?.observability_c;
//     const incomingAgents = params?.agents;
//     if (isPromiseLike<Record<string, AbstractAgent>>(incomingAgents)) {
//       this.agents = {};
//       // PromiseLike may not have .catch in the type; attach error handling via then's second arg
//       incomingAgents.then(
//         (resolved) => {
//           this.agents = resolved;
//         },
//         () => {},
//       );
//     } else {
//       this.agents = (incomingAgents as Record<string, AbstractAgent>) ?? {};
//     }
//     this.onError = params?.onError;
//     // +++ MCP Initialization +++
//     this.mcpServersConfig = params?.mcpServers;
//     this.createMCPClientImpl = params?.createMCPClient;
//
//     // Validate: If mcpServers are provided, createMCPClient must also be provided
//     if (this.mcpServersConfig && this.mcpServersConfig.length > 0 && !this.createMCPClientImpl) {
//       throw new CopilotKitMisuseError({
//         message:
//           "MCP Integration Error: `mcpServers` were provided, but the `createMCPClient` function was not passed to the CopilotRuntime constructor. " +
//           "Please provide an implementation for `createMCPClient`.",
//       });
//     }
//
//     // Warning if actions are defined alongside LangGraph platform (potentially MCP too?)
//     if (
//       params?.actions &&
//       (params?.remoteEndpoints?.some((e) => e.type === EndpointType.LangGraphPlatform) ||
//         this.mcpServersConfig?.length)
//     ) {
//       console.warn(
//         "Local 'actions' defined in CopilotRuntime might not be available to remote agents (LangGraph, MCP). Consider defining actions closer to the agent implementation if needed.",
//       );
//     }
//   }
//
//   // +++ MCP Instruction Injection Method +++
//   private injectMCPToolInstructions(
//     messages: MessageInput[],
//     currentActions: Action<any>[],
//   ): MessageInput[] {
//     // Filter the *passed-in* actions for MCP tools
//     const mcpActionsForRequest = currentActions.filter((action) => (action as any)._isMCPTool);
//
//     if (!mcpActionsForRequest || mcpActionsForRequest.length === 0) {
//       return messages; // No MCP tools for this specific request
//     }
//
//     // Create a map to deduplicate tools by name (keeping the last one if duplicates exist)
//     const uniqueMcpTools = new Map<string, Action<any>>();
//
//     // Add all MCP tools to the map with their names as keys
//     mcpActionsForRequest.forEach((action) => {
//       uniqueMcpTools.set(action.name, action);
//     });
//
//     // Format instructions from the unique tools map
//     // Convert Action objects to MCPTool format for the instruction generator
//     const toolsMap: Record<string, MCPTool> = {};
//     Array.from(uniqueMcpTools.values()).forEach((action) => {
//       toolsMap[action.name] = {
//         description: action.description || "",
//         schema: action.parameters
//           ? {
//               parameters: {
//                 properties: action.parameters.reduce(
//                   (acc, p) => ({
//                     ...acc,
//                     [p.name]: { type: p.type, description: p.description },
//                   }),
//                   {},
//                 ),
//                 required: action.parameters.filter((p) => p.required).map((p) => p.name),
//               },
//             }
//           : {},
//         execute: async () => ({}), // Placeholder, not used for instructions
//       };
//     });
//
//     // Generate instructions using the exported helper
//     const mcpToolInstructions = generateMcpToolInstructions(toolsMap);
//
//     if (!mcpToolInstructions) {
//       return messages; // No MCP tools to describe
//     }
//
//     const instructions =
//       mcpToolInstructions + "\nUse them when appropriate to fulfill the user's request.";
//
//     const systemMessageIndex = messages.findIndex((msg) => msg.textMessage?.role === "system");
//
//     const newMessages = [...messages]; // Create a mutable copy
//
//     if (systemMessageIndex !== -1) {
//       const existingMsg = newMessages[systemMessageIndex];
//       if (existingMsg.textMessage) {
//         existingMsg.textMessage.content =
//           (existingMsg.textMessage.content ? existingMsg.textMessage.content + "\n\n" : "") +
//           instructions;
//       }
//     } else {
//       newMessages.unshift({
//         id: randomId(),
//         createdAt: new Date(),
//         textMessage: {
//           role: MessageRole.system,
//           content: instructions,
//         },
//         actionExecutionMessage: undefined,
//         resultMessage: undefined,
//         agentStateMessage: undefined,
//       });
//     }
//
//     return newMessages;
//   }
//
//   async processRuntimeRequest(request: CopilotRuntimeRequest): Promise<CopilotRuntimeResponse> {
//     const {
//       serviceAdapter,
//       messages: rawMessages,
//       actions: clientSideActionsInput,
//       threadId,
//       runId,
//       outputMessagesPromise,
//       graphqlContext,
//       forwardedParameters,
//       url,
//       extensions,
//       agentSession,
//       agentStates,
//       publicApiKey,
//       context,
//     } = request;
//     graphqlContext.request.signal.addEventListener(
//       "abort",
//       () =>
//         this.onStopGeneration?.({
//           threadId,
//           runId,
//           url,
//           agentName: agentSession?.agentName,
//           lastMessage: rawMessages[rawMessages.length - 1],
//         }),
//       { once: true }, // optional: fire only once
//     );
//
//     const eventSource = new RuntimeEventSource({
//       errorHandler: async (error, context) => {
//         await this.error("error", context, error, publicApiKey);
//       },
//       errorContext: {
//         threadId,
//         runId,
//         source: "runtime",
//         request: {
//           operation: "processRuntimeRequest",
//           method: "POST",
//           url: url,
//           startTime: Date.now(),
//         },
//         agent: agentSession ? { name: agentSession.agentName } : undefined,
//         technical: {
//           environment: process.env.NODE_ENV,
//         },
//       },
//     });
//     // Track request start time for logging
//     const requestStartTime = Date.now();
//     // For storing streamed chunks if progressive logging is enabled
//     const streamedChunks: any[] = [];
//
//     try {
//       if (
//         Object.keys(this.agents).length &&
//         agentSession?.agentName &&
//         !this.delegateAgentProcessingToServiceAdapter
//       ) {
//         this.agents = { [agentSession.agentName]: this.agents[agentSession.agentName] };
//       }
//
//       if (agentSession && !this.delegateAgentProcessingToServiceAdapter) {
//         return await this.processAgentRequest(request);
//       }
//       if (serviceAdapter instanceof EmptyAdapter) {
//         throw new CopilotKitMisuseError({
//           message: `Invalid adapter configuration: EmptyAdapter is only meant to be used with agent lock mode.
// For non-agent components like useCopilotChatSuggestions, CopilotTextarea, or CopilotTask,
// please use an LLM adapter instead.`,
//         });
//       }
//
//       // +++ Get Server Side Actions (including dynamic MCP) EARLY +++
//       const serverSideActions = await this.getServerSideActions(request);
//       // --- Get Server Side Actions (including dynamic MCP) EARLY ---
//
//       // Filter raw messages *before* injection
//       const filteredRawMessages = rawMessages.filter((message) => !message.agentStateMessage);
//
//       // +++ Inject MCP Instructions based on current actions +++
//       const messagesWithInjectedInstructions = this.injectMCPToolInstructions(
//         filteredRawMessages,
//         serverSideActions,
//       );
//       const inputMessages = convertGqlInputToMessages(messagesWithInjectedInstructions);
//       // --- Inject MCP Instructions based on current actions ---
//
//       // Log LLM request if logging is enabled
//       if (this.observability?.enabled && publicApiKey) {
//         try {
//           const requestData: LLMRequestData = {
//             threadId,
//             runId,
//             model: forwardedParameters?.model,
//             messages: inputMessages,
//             actions: clientSideActionsInput,
//             forwardedParameters,
//             timestamp: requestStartTime,
//             provider: this.detectProvider(serviceAdapter),
//           };
//
//           await this.observability.hooks.handleRequest(requestData);
//         } catch (error) {
//           console.error("Error logging LLM request:", error);
//         }
//       }
//
//       const serverSideActionsInput: ActionInput[] = serverSideActions.map((action) => ({
//         name: action.name,
//         description: action.description,
//         jsonSchema: JSON.stringify(actionParametersToJsonSchema(action.parameters)),
//         additionalConfig: action.additionalConfig,
//       }));
//
//       const actionInputs = flattenToolCallsNoDuplicates([
//         ...serverSideActionsInput,
//         ...clientSideActionsInput.filter(
//           // Filter remote actions from CopilotKit core loop
//           (action) => action.available !== ActionInputAvailability.remote,
//         ),
//       ]);
//
//       await this.onBeforeRequest?.({
//         threadId,
//         runId,
//         inputMessages,
//         properties: graphqlContext.properties,
//         url,
//       });
//
//       const result = await serviceAdapter.process({
//         messages: inputMessages,
//         actions: actionInputs,
//         threadId,
//         runId,
//         eventSource,
//         forwardedParameters,
//         extensions,
//         agentSession,
//         agentStates,
//       });
//
//       // for backwards compatibility, we deal with the case that no threadId is provided
//       // by the frontend, by using the threadId from the response
//       const nonEmptyThreadId = threadId ?? result.threadId;
//
//       outputMessagesPromise
//         .then((outputMessages) => {
//           this.onAfterRequest?.({
//             threadId: nonEmptyThreadId,
//             runId: result.runId,
//             inputMessages,
//             outputMessages,
//             properties: graphqlContext.properties,
//             url,
//           });
//         })
//         .catch((_error) => {});
//
//       // After getting the response, log it if logging is enabled
//       if (this.observability?.enabled && publicApiKey) {
//         try {
//           outputMessagesPromise
//             .then((outputMessages) => {
//               const responseData: LLMResponseData = {
//                 threadId: result.threadId,
//                 runId: result.runId,
//                 model: forwardedParameters?.model,
//                 // Use collected chunks for progressive mode or outputMessages for regular mode
//                 output: this.observability.progressive ? streamedChunks : outputMessages,
//                 latency: Date.now() - requestStartTime,
//                 timestamp: Date.now(),
//                 provider: this.detectProvider(serviceAdapter),
//                 // Indicate this is the final response
//                 isFinalResponse: true,
//               };
//
//               try {
//                 this.observability.hooks.handleResponse(responseData);
//               } catch (logError) {
//                 console.error("Error logging LLM response:", logError);
//               }
//             })
//             .catch((error) => {
//               console.error("Failed to get output messages for logging:", error);
//             });
//         } catch (error) {
//           console.error("Error setting up logging for LLM response:", error);
//         }
//       }
//
//       // Add progressive logging if enabled
//       if (this.observability?.enabled && this.observability.progressive && publicApiKey) {
//         // Keep reference to original stream function
//         const originalStream = eventSource.stream.bind(eventSource);
//
//         // Wrap the stream function to intercept events
//         eventSource.stream = async (callback) => {
//           await originalStream(async (eventStream$) => {
//             // Create subscription to capture streaming events
//             eventStream$.subscribe({
//               next: (event) => {
//                 // Only log content chunks
//                 if (event.type === RuntimeEventTypes.TextMessageContent) {
//                   // Store the chunk
//                   streamedChunks.push(event.content);
//
//                   // Log each chunk separately for progressive mode
//                   try {
//                     const progressiveData: LLMResponseData = {
//                       threadId: threadId || "",
//                       runId,
//                       model: forwardedParameters?.model,
//                       output: event.content,
//                       latency: Date.now() - requestStartTime,
//                       timestamp: Date.now(),
//                       provider: this.detectProvider(serviceAdapter),
//                       isProgressiveChunk: true,
//                     };
//
//                     // Use Promise to handle async logger without awaiting
//                     Promise.resolve()
//                       .then(() => {
//                         this.observability.hooks.handleResponse(progressiveData);
//                       })
//                       .catch((error) => {
//                         console.error("Error in progressive logging:", error);
//                       });
//                   } catch (error) {
//                     console.error("Error preparing progressive log data:", error);
//                   }
//                 }
//               },
//             });
//
//             // Call the original callback with the event stream
//             await callback(eventStream$);
//           });
//         };
//       }
//
//       return {
//         threadId: nonEmptyThreadId,
//         runId: result.runId,
//         eventSource,
//         serverSideActions,
//         actionInputsWithoutAgents: actionInputs.filter(
//           (action) =>
//             // TODO-AGENTS: do not exclude ALL server side actions
//             !serverSideActions.find((serverSideAction) => serverSideAction.name == action.name),
//           // !isRemoteAgentAction(
//           //   serverSideActions.find((serverSideAction) => serverSideAction.name == action.name),
//           // ),
//         ),
//         extensions: result.extensions,
//       };
//     } catch (error) {
//       // Log error if logging is enabled
//       if (this.observability?.enabled && publicApiKey) {
//         try {
//           const errorData: LLMErrorData = {
//             threadId,
//             runId,
//             model: forwardedParameters?.model,
//             error: error instanceof Error ? error : String(error),
//             timestamp: Date.now(),
//             latency: Date.now() - requestStartTime,
//             provider: this.detectProvider(serviceAdapter),
//           };
//
//           await this.observability.hooks.handleError(errorData);
//         } catch (logError) {
//           console.error("Error logging LLM error:", logError);
//         }
//       }
//
//       let structuredError: CopilotKitError;
//
//       if (error instanceof CopilotKitError) {
//         structuredError = error;
//       } else {
//         // Convert non-CopilotKitErrors to structured errors, but preserve already structured ones
//         structuredError = ensureStructuredError(error, (err) =>
//           this.convertStreamingErrorToStructured(err),
//         );
//       }
//
//       // Track the error
//       await this.error(
//         "error",
//         {
//           threadId,
//           runId,
//           source: "runtime",
//           request: {
//             operation: "processRuntimeRequest",
//             method: "POST",
//             url: url,
//             startTime: requestStartTime,
//           },
//           response: {
//             endTime: Date.now(),
//             latency: Date.now() - requestStartTime,
//           },
//           agent: agentSession ? { name: agentSession.agentName } : undefined,
//           technical: {
//             environment: process.env.NODE_ENV,
//             stackTrace: error instanceof Error ? error.stack : undefined,
//           },
//         },
//         structuredError,
//         publicApiKey,
//       );
//
//       throw structuredError;
//     }
//   }
//
//   async getAllAgents(graphqlContext: GraphQLContext): Promise<(AgentWithEndpoint | Agent)[]> {
//     const agentsWithEndpoints = await this.discoverAgentsFromEndpoints(graphqlContext);
//     const aguiAgents = this.discoverAgentsFromAgui();
//
//     this.availableAgents = [...agentsWithEndpoints, ...aguiAgents].map((a) => ({
//       name: a.name,
//       id: a.id,
//     }));
//
//     return [...agentsWithEndpoints, ...aguiAgents];
//   }
//
//   async discoverAgentsFromEndpoints(graphqlContext: GraphQLContext): Promise<AgentWithEndpoint[]> {
//     const agents: Promise<AgentWithEndpoint[]> = this.remoteEndpointDefinitions.reduce(
//       async (acc: Promise<Agent[]>, endpoint) => {
//         const agents = await acc;
//         if (endpoint.type === EndpointType.LangGraphPlatform) {
//           const propertyHeaders = graphqlContext.properties.authorization
//             ? { authorization: `Bearer ${graphqlContext.properties.authorization}` }
//             : null;
//
//           const client = new LangGraphClient({
//             apiUrl: endpoint.deploymentUrl,
//             apiKey: endpoint.langsmithApiKey,
//             defaultHeaders: { ...propertyHeaders },
//           });
//           let data: Array<{ assistant_id: string; graph_id: string }> | { detail: string } = [];
//           try {
//             data = await client.assistants.search();
//
//             if (data && "detail" in data && (data.detail as string).toLowerCase() === "not found") {
//               throw new CopilotKitAgentDiscoveryError({ availableAgents: this.availableAgents });
//             }
//           } catch (e) {
//             throw new CopilotKitMisuseError({
//               message: `
//               Failed to find or contact remote endpoint at url ${endpoint.deploymentUrl}.
//               Make sure the API is running and that it's indeed a LangGraph platform url.
//
//               See more: https://docs.copilotkit.ai/troubleshooting/common-issues`,
//             });
//           }
//           const endpointAgents = data.map((entry) => ({
//             name: entry.graph_id,
//             id: entry.assistant_id,
//             description: "",
//             endpoint,
//           }));
//           return [...agents, ...endpointAgents];
//         }
//
//         interface InfoResponse {
//           agents?: Array<{
//             name: string;
//             description: string;
//           }>;
//         }
//         const cpkEndpoint = endpoint as CopilotKitEndpoint;
//         const fetchUrl = `${endpoint.url}/info`;
//         try {
//           const response = await fetchWithRetry(fetchUrl, {
//             method: "POST",
//             headers: createHeaders(cpkEndpoint.onBeforeRequest, graphqlContext),
//             body: JSON.stringify({ properties: graphqlContext.properties }),
//           });
//           if (!response.ok) {
//             if (response.status === 404) {
//               throw new CopilotKitApiDiscoveryError({ url: fetchUrl });
//             }
//             throw new ResolvedCopilotKitError({
//               status: response.status,
//               url: fetchUrl,
//               isRemoteEndpoint: true,
//             });
//           }
//
//           const data: InfoResponse = await response.json();
//           const endpointAgents = (data?.agents ?? []).map((agent) => ({
//             name: agent.name,
//             description: agent.description ?? "",
//             id: randomId(), // Required by Agent type
//             endpoint,
//           }));
//           return [...agents, ...endpointAgents];
//         } catch (error) {
//           if (error instanceof CopilotKitError) {
//             throw error;
//           }
//           throw new CopilotKitLowLevelError({ error: error as Error, url: fetchUrl });
//         }
//       },
//       Promise.resolve([]),
//     );
//
//     return agents;
//   }
//
//   discoverAgentsFromAgui(): Agent[] {
//     return Object.entries(this.agents ?? []).map(([key, agent]: [string, AbstractAgent]) => ({
//       name: (agent as any).agentName ?? key,
//       id: agent.agentId ?? key,
//       description: agent.description ?? "",
//     }));
//   }
//
//   async loadAgentState(
//     graphqlContext: GraphQLContext,
//     threadId: string,
//     agentName: string,
//   ): Promise<LoadAgentStateResponse> {
//     const agents = await this.getAllAgents(graphqlContext);
//
//     const agent = agents.find((agent) => agent.name === agentName);
//     if (!agent) {
//       throw new Error("Agent not found");
//     }
//
//     if (
//       "endpoint" in agent &&
//       (agent.endpoint.type === EndpointType.CopilotKit || !("type" in agent.endpoint))
//     ) {
//       const cpkEndpoint = agent.endpoint as CopilotKitEndpoint;
//       const fetchUrl = `${cpkEndpoint.url}/agents/state`;
//       try {
//         const response = await fetchWithRetry(fetchUrl, {
//           method: "POST",
//           headers: createHeaders(cpkEndpoint.onBeforeRequest, graphqlContext),
//           body: JSON.stringify({
//             properties: graphqlContext.properties,
//             threadId,
//             name: agentName,
//           }),
//         });
//         if (!response.ok) {
//           if (response.status === 404) {
//             throw new CopilotKitApiDiscoveryError({ url: fetchUrl });
//           }
//
//           // Extract semantic error information from response body
//           let errorMessage = `HTTP ${response.status} error`;
//           try {
//             const errorBody = await response.text();
//             const parsedError = JSON.parse(errorBody);
//             if (parsedError.error && typeof parsedError.error === "string") {
//               errorMessage = parsedError.error;
//             }
//           } catch {
//             // If parsing fails, fall back to generic message
//           }
//
//           throw new ResolvedCopilotKitError({
//             status: response.status,
//             url: fetchUrl,
//             isRemoteEndpoint: true,
//             message: errorMessage,
//           });
//         }
//
//         const data: LoadAgentStateResponse = await response.json();
//
//         return {
//           ...data,
//           state: JSON.stringify(data.state),
//           messages: JSON.stringify(data.messages),
//         };
//       } catch (error) {
//         if (error instanceof CopilotKitError) {
//           throw error;
//         }
//         throw new CopilotKitLowLevelError({ error, url: fetchUrl });
//       }
//     }
//
//     const propertyHeaders = graphqlContext.properties.authorization
//       ? { authorization: `Bearer ${graphqlContext.properties.authorization}` }
//       : null;
//
//     let state: any = {};
//     try {
//       let client: LangGraphClient | null;
//       if ("endpoint" in agent && agent.endpoint.type === EndpointType.LangGraphPlatform) {
//         client = new LangGraphClient({
//           apiUrl: agent.endpoint.deploymentUrl,
//           apiKey: agent.endpoint.langsmithApiKey,
//           defaultHeaders: { ...propertyHeaders },
//         });
//       } else {
//         // @ts-ignore
//         const aguiAgent = graphqlContext._copilotkit.runtime.agents[agent.name] as LangGraphAgent;
//         if (!aguiAgent) {
//           throw new Error(`Agent: ${agent.name} could not be resolved`);
//         }
//         // @ts-expect-error -- both clients are the same
//         client = aguiAgent.client ?? null;
//       }
//
//       state = client ? ((await client.threads.getState(threadId)).values as any) : {};
//     } catch (error) {
//       // All errors from agent state loading are user configuration issues
//       const errorMessage = error instanceof Error ? error.message : String(error);
//       const errorStatus = error?.response?.status || error?.status;
//
//       if (errorStatus === 404) {
//         state = {};
//       } else {
//         // Log user configuration errors at debug level to reduce noise
//         console.debug(`Agent '${agentName}' configuration issue: ${errorMessage}`);
//
//         // Throw a configuration error - all agent state loading failures are user setup issues
//         throw new ResolvedCopilotKitError({
//           status: 400,
//           message: `Agent '${agentName}' failed to execute: ${errorMessage}`,
//           code: CopilotKitErrorCode.CONFIGURATION_ERROR,
//         });
//       }
//     }
//
//     if (Object.keys(state).length === 0) {
//       return {
//         threadId: threadId || "",
//         threadExists: false,
//         state: JSON.stringify({}),
//         messages: JSON.stringify([]),
//       };
//     } else {
//       const { messages, ...stateWithoutMessages } = state;
//       const copilotkitMessages = langchainMessagesToCopilotKit(messages);
//       return {
//         threadId: threadId || "",
//         threadExists: true,
//         state: JSON.stringify(stateWithoutMessages),
//         messages: JSON.stringify(copilotkitMessages),
//       };
//     }
//
//     throw new Error(`Agent: ${agent.name} could not be resolved`);
//   }
//
//   private async processAgentRequest(
//     request: CopilotRuntimeRequest,
//   ): Promise<CopilotRuntimeResponse> {
//     const {
//       messages: rawMessages,
//       outputMessagesPromise,
//       graphqlContext,
//       agentSession,
//       threadId: threadIdFromRequest,
//       metaEvents,
//       publicApiKey,
//       forwardedParameters,
//       context,
//     } = request;
//     const { agentName, nodeName } = agentSession;
//
//     // Track request start time for observability
//     const requestStartTime = Date.now();
//     // For storing streamed chunks if progressive logging is enabled
//     const streamedChunks: any[] = [];
//
//     // for backwards compatibility, deal with the case when no threadId is provided
//     const threadId = threadIdFromRequest ?? agentSession.threadId;
//
//     // Track agent request start
//     await this.error(
//       "agent_state",
//       {
//         threadId,
//         source: "agent",
//         request: {
//           operation: "processAgentRequest",
//           method: "POST",
//           startTime: requestStartTime,
//         },
//         agent: {
//           name: agentName,
//           nodeName: nodeName,
//         },
//         messages: {
//           input: rawMessages,
//           messageCount: rawMessages.length,
//         },
//         technical: {
//           environment: process.env.NODE_ENV,
//         },
//       },
//       undefined,
//       publicApiKey,
//     );
//
//     const serverSideActions = await this.getServerSideActions(request);
//
//     const messages = convertGqlInputToMessages(rawMessages);
//
//     const currentAgent = serverSideActions.find(
//       (action) => action.name === agentName && isRemoteAgentAction(action),
//     ) as RemoteAgentAction;
//
//     if (!currentAgent) {
//       throw new CopilotKitAgentDiscoveryError({ agentName, availableAgents: this.availableAgents });
//     }
//
//     // Filter actions to include:
//     // 1. Regular (non-agent) actions
//     // 2. Other agents' actions (but prevent self-calls to avoid infinite loops)
//     const availableActionsForCurrentAgent: ActionInput[] = serverSideActions
//       .filter(
//         (action) =>
//           // Case 1: Keep all regular (non-agent) actions
//           !isRemoteAgentAction(action) ||
//           // Case 2: For agent actions, keep all except self (prevent infinite loops)
//           (isRemoteAgentAction(action) && action.name !== agentName) /* prevent self-calls */,
//       )
//       .map((action) => ({
//         name: action.name,
//         description: action.description,
//         jsonSchema: JSON.stringify(actionParametersToJsonSchema(action.parameters)),
//       }));
//
//     const allAvailableActions = flattenToolCallsNoDuplicates([
//       ...availableActionsForCurrentAgent,
//       ...request.actions,
//     ]);
//
//     // Log agent request if observability is enabled
//     if (this.observability?.enabled && publicApiKey) {
//       try {
//         const requestData: LLMRequestData = {
//           threadId,
//           runId: undefined,
//           model: forwardedParameters?.model,
//           messages,
//           actions: allAvailableActions,
//           forwardedParameters,
//           timestamp: requestStartTime,
//           provider: "agent",
//           agentName, // Add agent-specific context
//           nodeName,
//         };
//
//         await this.observability.hooks.handleRequest(requestData);
//       } catch (error) {
//         console.error("Error logging agent request:", error);
//       }
//     }
//
//     await this.onBeforeRequest?.({
//       threadId,
//       runId: undefined,
//       inputMessages: messages,
//       properties: graphqlContext.properties,
//     });
//
//     try {
//       const eventSource = new RuntimeEventSource({
//         errorHandler: async (error, context) => {
//           await this.error("error", context, error, publicApiKey);
//         },
//         errorContext: {
//           threadId,
//           source: "agent",
//           request: {
//             operation: "processAgentRequest",
//             method: "POST",
//             startTime: requestStartTime,
//           },
//           agent: {
//             name: agentName,
//             nodeName: nodeName,
//           },
//           technical: {
//             environment: process.env.NODE_ENV,
//           },
//         },
//       });
//       const stream = await currentAgent.remoteAgentHandler({
//         name: agentName,
//         threadId,
//         nodeName,
//         metaEvents,
//         actionInputsWithoutAgents: allAvailableActions,
//       });
//
//       // Add progressive observability if enabled
//       if (this.observability?.enabled && this.observability.progressive && publicApiKey) {
//         // Wrap the stream function to intercept events for observability without changing core logic
//         const originalStream = eventSource.stream.bind(eventSource);
//
//         eventSource.stream = async (callback) => {
//           await originalStream(async (eventStream$) => {
//             // Create subscription to capture streaming events
//             eventStream$.subscribe({
//               next: (event) => {
//                 // Only log content chunks
//                 if (event.type === RuntimeEventTypes.TextMessageContent) {
//                   // Store the chunk
//                   streamedChunks.push(event.content);
//
//                   // Log each chunk separately for progressive mode
//                   try {
//                     const progressiveData: LLMResponseData = {
//                       threadId: threadId || "",
//                       runId: undefined,
//                       model: forwardedParameters?.model,
//                       output: event.content,
//                       latency: Date.now() - requestStartTime,
//                       timestamp: Date.now(),
//                       provider: "agent",
//                       isProgressiveChunk: true,
//                       agentName,
//                       nodeName,
//                     };
//
//                     // Use Promise to handle async logger without awaiting
//                     Promise.resolve()
//                       .then(() => {
//                         this.observability.hooks.handleResponse(progressiveData);
//                       })
//                       .catch((error) => {
//                         console.error("Error in progressive agent logging:", error);
//                       });
//                   } catch (error) {
//                     console.error("Error preparing progressive agent log data:", error);
//                   }
//                 }
//               },
//             });
//
//             // Call the original callback with the event stream
//             await callback(eventStream$);
//           });
//         };
//       }
//
//       eventSource.stream(async (eventStream$) => {
//         from(stream).subscribe({
//           next: (event) => eventStream$.next(event),
//           error: async (err) => {
//             // Log error with observability if enabled
//             if (this.observability?.enabled && publicApiKey) {
//               try {
//                 const errorData: LLMErrorData = {
//                   threadId,
//                   runId: undefined,
//                   model: forwardedParameters?.model,
//                   error: err instanceof Error ? err : String(err),
//                   timestamp: Date.now(),
//                   latency: Date.now() - requestStartTime,
//                   provider: "agent",
//                   agentName,
//                   nodeName,
//                 };
//
//                 this.observability.hooks.handleError(errorData);
//               } catch (logError) {
//                 console.error("Error logging agent error:", logError);
//               }
//             }
//
//             // Preserve structured CopilotKit errors, only convert unstructured errors
//             const structuredError = ensureStructuredError(err, (error) =>
//               this.convertStreamingErrorToStructured(error),
//             );
//
//             // Track streaming errors
//             await this.error(
//               "error",
//               {
//                 threadId,
//                 source: "agent",
//                 request: {
//                   operation: "processAgentRequest",
//                   method: "POST",
//                   startTime: requestStartTime,
//                 },
//                 response: {
//                   endTime: Date.now(),
//                   latency: Date.now() - requestStartTime,
//                 },
//                 agent: {
//                   name: agentName,
//                   nodeName: nodeName,
//                 },
//                 technical: {
//                   environment: process.env.NODE_ENV,
//                   stackTrace: err instanceof Error ? err.stack : undefined,
//                 },
//               },
//               structuredError,
//               publicApiKey,
//             );
//
//             eventStream$.error(structuredError);
//             eventStream$.complete();
//           },
//           complete: () => eventStream$.complete(),
//         });
//       });
//
//       // Log final agent response when outputs are available
//       if (this.observability?.enabled && publicApiKey) {
//         outputMessagesPromise
//           .then((outputMessages) => {
//             const responseData: LLMResponseData = {
//               threadId,
//               runId: undefined,
//               model: forwardedParameters?.model,
//               // Use collected chunks for progressive mode or outputMessages for regular mode
//               output: this.observability.progressive ? streamedChunks : outputMessages,
//               latency: Date.now() - requestStartTime,
//               timestamp: Date.now(),
//               provider: "agent",
//               isFinalResponse: true,
//               agentName,
//               nodeName,
//             };
//
//             try {
//               this.observability.hooks.handleResponse(responseData);
//             } catch (logError) {
//               console.error("Error logging agent response:", logError);
//             }
//           })
//           .catch((error) => {
//             console.error("Failed to get output messages for agent logging:", error);
//           });
//       }
//
//       outputMessagesPromise
//         .then((outputMessages) => {
//           this.onAfterRequest?.({
//             threadId,
//             runId: undefined,
//             inputMessages: messages,
//             outputMessages,
//             properties: graphqlContext.properties,
//           });
//         })
//         .catch((_error) => {});
//
//       return {
//         threadId,
//         runId: undefined,
//         eventSource,
//         serverSideActions,
//         actionInputsWithoutAgents: allAvailableActions,
//       };
//     } catch (error) {
//       // Log error with observability if enabled
//       if (this.observability?.enabled && publicApiKey) {
//         try {
//           const errorData: LLMErrorData = {
//             threadId,
//             runId: undefined,
//             model: forwardedParameters?.model,
//             error: error instanceof Error ? error : String(error),
//             timestamp: Date.now(),
//             latency: Date.now() - requestStartTime,
//             provider: "agent",
//             agentName,
//             nodeName,
//           };
//
//           await this.observability.hooks.handleError(errorData);
//         } catch (logError) {
//           console.error("Error logging agent error:", logError);
//         }
//       }
//
//       // Ensure error is structured
//       const structuredError = ensureStructuredError(error, (err) =>
//         this.convertStreamingErrorToStructured(err),
//       );
//
//       // Track the agent error
//       await this.error(
//         "error",
//         {
//           threadId,
//           source: "agent",
//           request: {
//             operation: "processAgentRequest",
//             method: "POST",
//             startTime: requestStartTime,
//           },
//           response: {
//             endTime: Date.now(),
//             latency: Date.now() - requestStartTime,
//           },
//           agent: {
//             name: agentName,
//             nodeName: nodeName,
//           },
//           technical: {
//             environment: process.env.NODE_ENV,
//             stackTrace: error instanceof Error ? error.stack : undefined,
//           },
//         },
//         structuredError,
//         publicApiKey,
//       );
//
//       console.error("Error getting response:", error);
//       throw structuredError;
//     }
//   }
//
//   private async getServerSideActions(request: CopilotRuntimeRequest): Promise<Action<any>[]> {
//     const { graphqlContext, messages: rawMessages, agentStates, url } = request;
//
//     // --- Standard Action Fetching (unchanged) ---
//     const inputMessages = convertGqlInputToMessages(rawMessages);
//     const langserveFunctions: Action<any>[] = [];
//     for (const chainPromise of this.langserve) {
//       try {
//         const chain = await chainPromise;
//         langserveFunctions.push(chain);
//       } catch (error) {
//         console.error("Error loading langserve chain:", error);
//       }
//     }
//
//     const remoteEndpointDefinitions = this.remoteEndpointDefinitions.map(
//       (endpoint) => ({ ...endpoint, type: resolveEndpointType(endpoint) }) as EndpointDefinition,
//     );
//
//     const remoteActions = await setupRemoteActions({
//       remoteEndpointDefinitions,
//       graphqlContext,
//       messages: inputMessages,
//       agentStates,
//       frontendUrl: url,
//       agents: this.agents,
//       metaEvents: request.metaEvents,
//       nodeName: request.agentSession?.nodeName,
//       context: request.context,
//     });
//
//     const configuredActions =
//       typeof this.actions === "function"
//         ? this.actions({ properties: graphqlContext.properties, url })
//         : this.actions;
//     // --- Standard Action Fetching (unchanged) ---
//
//     // +++ Dynamic MCP Action Fetching +++
//     const requestSpecificMCPActions: Action<any>[] = [];
//     if (this.createMCPClientImpl) {
//       // 1. Determine effective MCP endpoints for this request
//       const baseEndpoints = this.mcpServersConfig || [];
//       // Assuming frontend passes config via properties.mcpServers
//       const requestEndpoints = (graphqlContext.properties?.mcpServers ||
//         graphqlContext.properties?.mcpEndpoints ||
//         []) as MCPEndpointConfig[];
//
//       // Merge and deduplicate endpoints based on URL
//       const effectiveEndpointsMap = new Map<string, MCPEndpointConfig>();
//
//       // First add base endpoints (from runtime configuration)
//       [...baseEndpoints].forEach((ep) => {
//         if (ep && ep.endpoint) {
//           effectiveEndpointsMap.set(ep.endpoint, ep);
//         }
//       });
//
//       // Then add request endpoints (from frontend), which will override duplicates
//       [...requestEndpoints].forEach((ep) => {
//         if (ep && ep.endpoint) {
//           effectiveEndpointsMap.set(ep.endpoint, ep);
//         }
//       });
//
//       const effectiveEndpoints = Array.from(effectiveEndpointsMap.values());
//
//       // 2. Fetch/Cache actions for effective endpoints
//       for (const config of effectiveEndpoints) {
//         const endpointUrl = config.endpoint;
//         let actionsForEndpoint: Action<any>[] | undefined = this.mcpActionCache.get(endpointUrl);
//
//         if (!actionsForEndpoint) {
//           // Not cached, fetch now
//           let client: MCPClient | null = null;
//           try {
//             client = await this.createMCPClientImpl(config);
//             const tools = await client.tools();
//             actionsForEndpoint = convertMCPToolsToActions(tools, endpointUrl);
//             this.mcpActionCache.set(endpointUrl, actionsForEndpoint); // Store in cache
//           } catch (error) {
//             console.error(
//               `MCP: Failed to fetch tools from endpoint ${endpointUrl}. Skipping. Error:`,
//               error,
//             );
//             actionsForEndpoint = []; // Assign empty array on error to prevent re-fetching constantly
//             this.mcpActionCache.set(endpointUrl, actionsForEndpoint); // Cache the failure (empty array)
//           }
//         }
//         requestSpecificMCPActions.push(...(actionsForEndpoint || []));
//       }
//     }
//     // --- Dynamic MCP Action Fetching ---
//
//     // Combine all action sources, including the dynamically fetched MCP actions
//     return [
//       ...configuredActions,
//       ...langserveFunctions,
//       ...remoteActions,
//       ...requestSpecificMCPActions,
//     ];
//   }
//
//   // Add helper method to detect provider
//   private detectProvider(serviceAdapter: CopilotServiceAdapter): string | undefined {
//     const adapterName = serviceAdapter.constructor.name;
//     if (adapterName.includes("OpenAI")) return "openai";
//     if (adapterName.includes("Anthropic")) return "anthropic";
//     if (adapterName.includes("Google")) return "google";
//     if (adapterName.includes("Groq")) return "groq";
//     if (adapterName.includes("LangChain")) return "langchain";
//     return undefined;
//   }
//
//   private convertStreamingErrorToStructured(error: any): CopilotKitError {
//     // Determine a more helpful error message based on context
//     let helpfulMessage = generateHelpfulErrorMessage(error, "agent streaming connection");
//
//     // For network-related errors, use CopilotKitLowLevelError to preserve the original error
//     if (
//       error?.message?.includes("fetch failed") ||
//       error?.message?.includes("ECONNREFUSED") ||
//       error?.message?.includes("ENOTFOUND") ||
//       error?.message?.includes("ETIMEDOUT") ||
//       error?.message?.includes("terminated") ||
//       error?.cause?.code === "UND_ERR_SOCKET" ||
//       error?.message?.includes("other side closed") ||
//       error?.code === "UND_ERR_SOCKET"
//     ) {
//       return new CopilotKitLowLevelError({
//         error: error instanceof Error ? error : new Error(String(error)),
//         url: "agent streaming connection",
//         message: helpfulMessage,
//       });
//     }
//
//     // For all other errors, preserve the raw error in a basic CopilotKitError
//     return new CopilotKitError({
//       message: helpfulMessage,
//       code: CopilotKitErrorCode.UNKNOWN,
//     });
//   }
//
//   private async error(
//     type: CopilotErrorEvent["type"],
//     context: CopilotRequestContext,
//     error?: any,
//     publicApiKey?: string,
//   ): Promise<void> {
//     if (!this.onError) return;
//
//     // Just check if publicApiKey is defined (regardless of validity)
//     if (!publicApiKey) {
//       if (!this.hasWarnedAboutError) {
//         console.warn(
//           "CopilotKit: onError handler provided but requires publicApiKey to be defined for error handling to work.",
//         );
//         this.hasWarnedAboutError = true;
//       }
//       return;
//     }
//
//     try {
//       const errorEvent: CopilotErrorEvent = {
//         type,
//         timestamp: Date.now(),
//         context,
//         ...(error && { error }),
//       };
//
//       await this.onError(errorEvent);
//     } catch (errorHandlerError) {
//       // Don't let error handler errors break the main flow
//       console.error("Error in onError handler:", errorHandlerError);
//     }
//   }
//
//   /**
//    * Public method to handle GraphQL validation errors
//    * This allows the GraphQL resolver to send validation errors through the error system
//    */
//   public async errorGraphQLError(
//     error: { message: string; code: string; type: string },
//     context: {
//       operation: string;
//       cloudConfigPresent: boolean;
//       guardrailsEnabled: boolean;
//     },
//   ): Promise<void> {
//     if (!this.onError) return;
//
//     try {
//       await this.onError({
//         type: "error",
//         timestamp: Date.now(),
//         context: {
//           source: "runtime",
//           request: {
//             operation: context.operation,
//             startTime: Date.now(),
//           },
//           technical: {
//             environment: process.env.NODE_ENV,
//           },
//           metadata: {
//             errorType: "GraphQLValidationError",
//             cloudConfigPresent: context.cloudConfigPresent,
//             guardrailsEnabled: context.guardrailsEnabled,
//           },
//         },
//         error,
//       });
//     } catch (errorHandlerError) {
//       // Don't let error handler errors break the main flow
//       console.error("Error in onError handler:", errorHandlerError);
//     }
//   }
// }

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
