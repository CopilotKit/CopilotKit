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
import { BasicAgent, BasicAgentConfiguration } from "@copilotkitnext/agent";
// Define the function type alias here or import if defined elsewhere
type CreateMCPClientFunction = (config: MCPEndpointConfig) => Promise<MCPClient>;

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
export class CopilotRuntime<const T extends Parameter[] | [] = []> {
  params?: CopilotRuntimeConstructorParams<T>;
  private observability?: CopilotObservabilityConfig;
  // Cache MCP tools per endpoint to avoid re-fetching repeatedly
  private mcpToolsCache: Map<string, BasicAgentConfiguration["tools"]> = new Map();
  private runtimeArgs: CopilotRuntimeOptions;
  private _instance: CopilotRuntimeVNext;

  constructor(
    params?: CopilotRuntimeConstructorParams<T> & PartialBy<CopilotRuntimeOptions, "agents">,
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

  private assignEndpointsToAgents(
    endpoints: CopilotRuntimeConstructorParams<T>["remoteEndpoints"],
  ) {
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

        if (this.params.actions) {
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
    params?: CopilotRuntimeConstructorParams<T> & PartialBy<CopilotRuntimeOptions, "agents">,
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
    params?: CopilotRuntimeConstructorParams<T> & PartialBy<CopilotRuntimeOptions, "agents">,
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
