/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — copilotKitEndpoint:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Runtime server adapter): https://docs.copilotkit.ai/runtime-server-adapter
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — CopilotRuntime:
 *   V2 import and usage:
 *     import { CopilotRuntime } from "@copilotkit/runtime/v2";
 *
 *     const runtime = new CopilotRuntime({ agents: {} });
 *   V2 replacement source: packages/runtime/src/v2/runtime/core/runtime.ts
 *   V2 docs: https://docs.copilotkit.ai/runtime-server-adapter
 *   Migration note: V2 uses AG-UI runtime handlers instead of the v1 GraphQL adapter setup.
 *
 * @copilotkit/runtime — CopilotRuntimeConstructorParams_BASE:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Runtime server adapter): https://docs.copilotkit.ai/runtime-server-adapter
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — langGraphPlatformEndpoint:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (LangGraph agents): https://docs.copilotkit.ai/agent-spec/langgraph
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — resolveEndpointType:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Runtime server adapter): https://docs.copilotkit.ai/runtime-server-adapter
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

/**
 * <Callout type="info">
 *   This is the reference for the `CopilotRuntime` class. For more information and example code snippets, please see [Concept: Copilot Runtime](/backend/copilot-runtime).
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
  CopilotKitMisuseError,
  readBody,
  getZodParameters,
  isTelemetryDisabled,
} from "@copilotkit/shared";
import { resolveMCPEntry } from "./mcp-client-cache";
import type {
  Action,
  CopilotErrorHandler,
  MaybePromise,
  NonEmptyRecord,
  Parameter,
  PartialBy,
  DebugConfig,
  TelemetryCapture,
} from "@copilotkit/shared";
import type { RunAgentInput } from "@ag-ui/core";
import { aguiToGQL } from "../../graphql/message-conversion/agui-to-gql";
import type {
  CopilotServiceAdapter,
  RemoteChainParameters,
} from "../../service-adapters";
import {
  CopilotRuntime as CopilotRuntimeVNext,
  InMemoryAgentRunner,
} from "../../../v2/runtime";
import {
  createRuntimeErrorReporter,
  runtimeErrorReporterOption,
} from "../../../v2/runtime/core/runtime-error-reporter";
import type { RuntimeErrorReporterOptions } from "../../../v2/runtime/core/runtime-error-reporter";
import type {
  CopilotIntelligenceRuntimeOptions,
  CopilotRuntimeOptions,
  CopilotRuntimeOptions as CopilotRuntimeOptionsVNext,
  AgentRunner,
  AgentsConfig,
  AgentsFactory,
  AgentFactoryContext,
} from "../../../v2/runtime";

export type { AgentsConfig, AgentsFactory, AgentFactoryContext };
import { TelemetryAgentRunner } from "./telemetry-agent-runner";
import telemetry from "../telemetry-client";
import { logRuntimeTelemetryDisclosure } from "../telemetry-disclosure";

import type { MessageInput } from "../../graphql/inputs/message.input";
import type { Message } from "../../graphql/types/converted";

import { EndpointType } from "./types";
import type {
  EndpointDefinition,
  CopilotKitEndpoint,
  LangGraphPlatformEndpoint,
} from "./types";

import type {
  CopilotObservabilityConfig,
  LLMRequestData,
  LLMResponseData,
} from "../observability";
import type { AbstractAgent } from "@ag-ui/client";
import {
  firstNonBlankLicenseToken,
  firstNonBlankTelemetryId,
} from "../../../v2/runtime/telemetry/telemetry-identity";

// +++ MCP Imports +++
import { extractParametersFromSchema } from "./mcp-tools-utils";
import type { MCPClient, MCPEndpointConfig, MCPTool } from "./mcp-tools-utils";
import { BuiltInAgent } from "../../../agent";
import type { BuiltInAgentClassicConfig } from "../../../agent";
// Define the function type alias here or import if defined elsewhere
type CreateMCPClientFunction = (
  config: MCPEndpointConfig,
) => Promise<MCPClient>;

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

type OnBeforeRequestHandler = (
  options: OnBeforeRequestOptions,
) => void | Promise<void>;

interface OnAfterRequestOptions {
  threadId: string;
  runId?: string;
  inputMessages: Message[];
  outputMessages: Message[];
  properties: any;
  url?: string;
}

type OnAfterRequestHandler = (
  options: OnAfterRequestOptions,
) => void | Promise<void>;

interface OnStopGenerationOptions {
  threadId: string;
  runId?: string;
  url?: string;
  agentName?: string;
  lastMessage: MessageInput;
}
type OnStopGenerationHandler = (
  options: OnStopGenerationOptions,
) => void | Promise<void>;

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

export interface CopilotRuntimeConstructorParams_BASE<
  T extends Parameter[] | [] = [],
> {
  /** Standalone telemetry identity. Falls back to CPK_TELEMETRY_ID before legacy license identity. */
  telemetryId?: string;
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

  /**
   * Optional agent runner to use for SSE runtime.
   */
  runner?: AgentRunner;

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

  /**
   * Enable debug logging for the runtime event pipeline.
   * Pass `true` for full output, or an object for granular control:
   *
   * ```ts
   * const runtime = new CopilotRuntime({
   *   debug: true,
   *   // or: debug: { events: true, lifecycle: true, verbose: false }
   * });
   * ```
   */
  debug?: DebugConfig;

  // /** Optional transcription service for audio processing. */
  // transcriptionService?: CopilotRuntimeOptionsVNext["transcriptionService"];
  // /** Optional *before* middleware – callback function or webhook URL. */
  // beforeRequestMiddleware?: CopilotRuntimeOptionsVNext["beforeRequestMiddleware"];
  // /** Optional *after* middleware – callback function or webhook URL. */
  // afterRequestMiddleware?: CopilotRuntimeOptionsVNext["afterRequestMiddleware"];
}

type BeforeRequestMiddleware =
  CopilotRuntimeOptionsVNext["beforeRequestMiddleware"];
type AfterRequestMiddleware =
  CopilotRuntimeOptionsVNext["afterRequestMiddleware"];
type BeforeRequestMiddlewareFn = Exclude<BeforeRequestMiddleware, string>;
type BeforeRequestMiddlewareFnParameters =
  Parameters<BeforeRequestMiddlewareFn>;
type BeforeRequestMiddlewareFnResult = ReturnType<BeforeRequestMiddlewareFn>;
type AfterRequestMiddlewareFn = Exclude<AfterRequestMiddleware, string>;
type AfterRequestMiddlewareFnParameters = Parameters<AfterRequestMiddlewareFn>;

interface CopilotRuntimeConstructorParams<T extends Parameter[] | [] = []>
  extends
    Omit<CopilotRuntimeConstructorParams_BASE<T>, "agents">,
    Omit<CopilotRuntimeOptionsVNext, "agents" | "transcriptionService"> {
  /**
   * TODO: un-omit `transcriptionService` above once it's supported
   *
   * This satisfies...
   *  – the optional constraint in `CopilotRuntimeConstructorParams_BASE`
   *  – the `MaybePromise<NonEmptyRecord<T>>` constraint in `CopilotRuntimeOptionsVNext`
   *  – the `Record<string, AbstractAgent>` constraint in `both
   */
  agents?: AgentsConfig;

  intelligence?: CopilotIntelligenceRuntimeOptions["intelligence"];
  identifyUser?: CopilotIntelligenceRuntimeOptions["identifyUser"];
  memory?: CopilotIntelligenceRuntimeOptions["memory"];
  channels?: CopilotIntelligenceRuntimeOptions["channels"];
  ɵlearning?: CopilotIntelligenceRuntimeOptions["ɵlearning"];
  generateThreadNames?: CopilotIntelligenceRuntimeOptions["generateThreadNames"];
  maxReconnectMs?: CopilotIntelligenceRuntimeOptions["maxReconnectMs"];
  maxRejoinMs?: CopilotIntelligenceRuntimeOptions["maxRejoinMs"];
  lockTtlSeconds?: CopilotIntelligenceRuntimeOptions["lockTtlSeconds"];
  lockKeyPrefix?: CopilotIntelligenceRuntimeOptions["lockKeyPrefix"];
  lockHeartbeatIntervalSeconds?: CopilotIntelligenceRuntimeOptions["lockHeartbeatIntervalSeconds"];
}

/**
 * Central runtime object passed to all request handlers.
 * @deprecated The v1 SDK is deprecated. Use v2 instead. Use `CopilotRuntime` from `@copilotkit/runtime/v2` instead.
 *
 * ```tsx
 * import { CopilotRuntime } from "@copilotkit/runtime/v2";
 *
 * const runtime = new CopilotRuntime({ agents: {} });
 * ```
 * See https://docs.copilotkit.ai/runtime-server-adapter
 */
export class CopilotRuntime<const T extends Parameter[] | [] = []> {
  params?: CopilotRuntimeConstructorParams<T>;
  private observability?: CopilotObservabilityConfig;
  /**
   * The request-independent half of agent resolution: validation, and the
   * default agent built from the service adapter. Resolved once, because
   * re-running the misuse checks on every request would turn a configuration
   * error into a per-request throw.
   */
  private baseAgents?: Promise<Record<string, AbstractAgent>>;
  /**
   * The `agents` value as configured, captured before the per-request factory
   * replaces it, so that repeated `handleServiceAdapter` calls do not wrap the
   * factory in itself.
   */
  private configuredAgents?: CopilotRuntimeOptions["agents"];
  private runtimeArgs: CopilotRuntimeOptions & RuntimeErrorReporterOptions;
  private _instance: CopilotRuntimeVNext;
  /** Runtime-bound telemetry identity and sampling authority. */
  public readonly telemetry: TelemetryCapture;

  constructor(params?: CopilotRuntimeConstructorParams<T>) {
    logRuntimeTelemetryDisclosure();

    const agents = params?.agents ?? {};
    const endpointAgents = this.assignEndpointsToAgents(
      params?.remoteEndpoints ?? [],
    );

    // Merge endpoint agents with user-provided agents.
    // When agents is a factory function, wrap it so endpoint agents are merged
    // at resolution time (spreading a function produces {} — silent data loss).
    let mergedAgents: AgentsConfig;
    if (typeof agents === "function") {
      mergedAgents = async (ctx) => {
        const resolved = await agents(ctx);
        return { ...endpointAgents, ...resolved };
      };
    } else {
      mergedAgents = Promise.resolve(agents).then((resolved) => ({
        ...endpointAgents,
        ...resolved,
      }));
    }

    // Resolve identity once and bind it to this compatibility Runtime. The
    // capture scope shares process-level sinks and settings without exposing
    // mutable identity to other live runtimes.
    const resolvedLicenseToken = firstNonBlankLicenseToken(
      params?.licenseToken,
      process.env.COPILOTKIT_LICENSE_TOKEN,
    );
    const resolvedTelemetryId = firstNonBlankTelemetryId(
      params?.telemetryId,
      process.env.CPK_TELEMETRY_ID,
    );
    const resolvedTelemetryIdentity =
      resolvedTelemetryId !== undefined
        ? { telemetryId: resolvedTelemetryId }
        : resolvedLicenseToken !== undefined
          ? { licenseToken: resolvedLicenseToken }
          : {};
    this.telemetry = telemetry.createScope(resolvedTelemetryIdentity);

    // Determine the base runner (user-provided or default)
    const baseRunner = params?.runner ?? new InMemoryAgentRunner();

    // Wrap with TelemetryAgentRunner unless telemetry is disabled
    // This ensures we always capture agent execution telemetry when enabled,
    // even if the user provides their own custom runner.
    const runner = isTelemetryDisabled()
      ? baseRunner
      : new TelemetryAgentRunner({
          runner: baseRunner,
          telemetry: this.telemetry,
        });

    const sharedRuntimeArgs = {
      agents: mergedAgents,
      telemetryId: resolvedTelemetryId,
      licenseToken: resolvedLicenseToken,
      telemetryProperties: params?.telemetryProperties,
      debug: params?.debug,
      // TODO: add support for transcriptionService from CopilotRuntimeOptionsVNext once it is ready
      // transcriptionService: params?.transcriptionService,

      beforeRequestMiddleware:
        this.createOnBeforeRequestHandler(params).bind(this),
      ...(params?.afterRequestMiddleware || params?.middleware?.onAfterRequest
        ? {
            afterRequestMiddleware:
              this.createOnAfterRequestHandler(params).bind(this),
          }
        : {}),
      a2ui: params?.a2ui,
      mcpApps: params?.mcpApps,
      openGenerativeUI: params?.openGenerativeUI,
      [runtimeErrorReporterOption]: createRuntimeErrorReporter(params?.onError),
      forwardHeaders: params?.forwardHeaders,
      exposeMemoryRoutes: params?.exposeMemoryRoutes,
    };
    if (params?.intelligence !== undefined) {
      // The compatibility constructor keeps Intelligence identity optional at
      // compile time, while the v2 runtime checks that callers supply web
      // identity, Channels, or both. Preserve that runtime validation here.
      this.runtimeArgs = {
        ...sharedRuntimeArgs,
        intelligence: params.intelligence,
        identifyUser: params.identifyUser,
        memory: params.memory,
        channels: params.channels,
        ɵlearning: params.ɵlearning,
        generateThreadNames: params.generateThreadNames,
        maxReconnectMs: params.maxReconnectMs,
        maxRejoinMs: params.maxRejoinMs,
        lockTtlSeconds: params.lockTtlSeconds,
        lockKeyPrefix: params.lockKeyPrefix,
        lockHeartbeatIntervalSeconds: params.lockHeartbeatIntervalSeconds,
      } as CopilotRuntimeOptions;
    } else {
      this.runtimeArgs = {
        ...sharedRuntimeArgs,
        runner,
      };
    }
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
  ): Record<string, AbstractAgent> {
    let result: Record<string, AbstractAgent> = {};

    if (
      endpoints.some(
        (endpoint) =>
          resolveEndpointType(endpoint) == EndpointType.LangGraphPlatform,
      )
    ) {
      throw new CopilotKitMisuseError({
        message:
          "LangGraphPlatformEndpoint in remoteEndpoints is deprecated. " +
          'Please use the "agents" option instead with LangGraphAgent from "@copilotkit/runtime/langgraph". ' +
          'Example: agents: { myAgent: new LangGraphAgent({ deploymentUrl: "...", graphId: "..." }) }',
      });
    }

    return result;
  }

  handleServiceAdapter(serviceAdapter: CopilotServiceAdapter) {
    // Capture the configured value before the factory below replaces it, so a
    // second call does not wrap the factory in itself.
    this.configuredAgents ??= this.runtimeArgs.agents ?? {};
    const configuredAgents = this.configuredAgents;

    // Resolve the request-independent half once. Calling this twice (the
    // endpoint factory runs on every request under the documented v1 route)
    // must not re-validate or rebuild the default agent.
    //
    // A caller who supplied their own agents factory has no request-independent
    // half: their record is whatever they return for this request, so the same
    // checks run per request further down.
    if (typeof configuredAgents !== "function") {
      this.baseAgents ??= Promise.resolve(configuredAgents).then((agents) =>
        this.ensureDefaultAgent(
          agents as Record<string, AbstractAgent>,
          serviceAdapter,
        ),
      );
      // A misconfigured adapter rejects that promise, and nothing awaits it
      // until the first request arrives. Attach an inert handler so a runtime
      // that is never called does not surface an unhandled rejection; the
      // factory below still sees the rejection when it awaits.
      this.baseAgents.catch(() => {});
    }

    // Install the per-request factory the v2 runtime has supported since
    // #2941. Resolving once was what kept a dynamic `actions` function from
    // ever seeing request properties, and kept every request sharing one MCP
    // client regardless of whose credentials built it (#7116, #2407).
    const resolvePerRequest = async ({ request }: { request: Request }) => {
      // A caller-supplied agents factory is called here, with this request.
      // Treating it as a record instead (a function has no enumerable keys)
      // meant the service adapter's default replaced it and the caller's
      // function was never invoked at all.
      const baseAgents =
        typeof configuredAgents === "function"
          ? this.ensureDefaultAgent(
              { ...(await configuredAgents({ request })) },
              serviceAdapter,
            )
          : await this.baseAgents!;
      const properties = await this.readRequestProperties(request);
      const actions = this.params?.actions;

      // `actions` and `mcpServers` are attached independently: a runtime may
      // configure MCP servers without any local actions.
      const mcpTools = await this.getToolsFromMCP({ properties });
      const actionTools = actions
        ? this.getToolsFromActions(actions, { properties, url: request.url })
        : [];
      const tools = [...actionTools, ...mcpTools];

      // Nothing to attach means nothing to isolate: hand the record back
      // untouched, exactly as a runtime with no actions and no MCP behaved
      // before this became a factory.
      if (!tools.length) {
        return baseAgents;
      }

      // Clone before attaching. `assignToolsToAgents` writes `config` onto the
      // agent, so mutating the shared instances would let one request's tools
      // reach another request that is already in flight.
      const perRequestAgents: Record<string, AbstractAgent> = {};
      for (const [agentId, agent] of Object.entries(baseAgents)) {
        const clone = agent.clone() as AbstractAgent;
        // `BuiltInAgent.clone()` rebuilds from `this.config`, so its own tools
        // survive. An agent whose `clone()` does not know about `config` --
        // `HttpAgent`, and anything else a v1 user registered -- would arrive
        // here empty, and the tools it declares itself would be shadowed by a
        // v1 action of the same name. Carry the config across when the clone
        // did not.
        if (
          Reflect.get(clone, "config") === undefined &&
          Reflect.get(agent, "config") !== undefined
        ) {
          Reflect.set(clone, "config", Reflect.get(agent, "config"));
        }
        perRequestAgents[agentId] = clone;
      }

      return this.assignToolsToAgents(perRequestAgents, tools);
    };

    this.runtimeArgs.agents =
      resolvePerRequest as unknown as CopilotRuntimeOptions["agents"];
  }

  /**
   * Fill in the default agent the service adapter implies, and reject a
   * configuration that names no model at all.
   */
  private ensureDefaultAgent(
    agentsList: Record<string, AbstractAgent>,
    serviceAdapter: CopilotServiceAdapter,
  ): Record<string, AbstractAgent> {
    const isAgentsListEmpty = !Object.keys(agentsList).length;
    const hasServiceAdapter = Boolean(serviceAdapter);
    const illegalServiceAdapterNames = ["EmptyAdapter"];
    const serviceAdapterCanBeUsedForAgent =
      !illegalServiceAdapterNames.includes(serviceAdapter.name);

    if (
      isAgentsListEmpty &&
      (!hasServiceAdapter || !serviceAdapterCanBeUsedForAgent)
    ) {
      throw new CopilotKitMisuseError({
        message:
          "No default agent provided. Please provide a default agent in the runtime config.",
      });
    }

    if (isAgentsListEmpty) {
      const languageModel = serviceAdapter.getLanguageModel?.();
      if (languageModel) {
        // Adapter exposes a pre-configured LanguageModel (e.g. OpenAI/Anthropic adapters)
        agentsList.default = new BuiltInAgent({ model: languageModel });
      } else if (serviceAdapter.provider && serviceAdapter.model) {
        // Adapter exposes provider/model strings
        agentsList.default = new BuiltInAgent({
          model: `${serviceAdapter.provider}/${serviceAdapter.model}`,
        });
      } else {
        throw new CopilotKitMisuseError({
          message:
            `Service adapter "${serviceAdapter.name ?? "unknown"}" does not provide model information. ` +
            `When using adapters like LangChainAdapter without an explicit agents list, ` +
            `please provide a default agent in the runtime config. Example:\n` +
            `  new CopilotRuntime({\n` +
            `    agents: { default: new BuiltInAgent({ model: "openai/gpt-4o" }) }\n` +
            `  })`,
        });
      }
    }

    return agentsList;
  }

  /**
   * The `forwardedProps` the browser sent with this request, which is what a
   * v1 `actions` function and `mcpServers` overrides are documented to read.
   *
   * `readBody` clones, so the handler still gets an unconsumed body, and it
   * returns `undefined` for GET, which is how the `/info` route reaches here.
   */
  private async readRequestProperties(
    request: Request,
  ): Promise<Record<string, unknown>> {
    try {
      const body = (await readBody(request)) as RunAgentInput | undefined;
      const properties = body?.forwardedProps;
      return properties && typeof properties === "object"
        ? (properties as Record<string, unknown>)
        : {};
    } catch {
      // A malformed body is the request handler's problem to report, not a
      // reason to fail agent resolution.
      return {};
    }
  }

  // Receive this.params.action and turn it into the AbstractAgent tools
  private getToolsFromActions(
    actions: ActionsConfiguration<any>,
    ctx: { properties: Record<string, unknown>; url?: string },
  ): BuiltInAgentClassicConfig["tools"] {
    // Resolve actions to an array (handle function case).
    //
    // The function form is documented to receive the request's properties and
    // url. It was called once at resolution time with `{ properties: {}, url:
    // undefined }`, so a runtime that keyed its action list on the tenant, the
    // user, or anything else request-shaped got the same empty context every
    // time (#7116).
    const actionsArray =
      typeof actions === "function"
        ? actions({ properties: ctx.properties, url: ctx.url })
        : actions;

    // Convert each Action to a ToolDefinition
    return actionsArray.map((action) => {
      // Convert JSON schema to Zod schema
      const zodSchema = getZodParameters(action.parameters || []);

      return {
        name: action.name,
        description: action.description || "",
        parameters: zodSchema,
        // `handler` is an in-process function and was never part of the remote
        // executor deleted in v1.50.0 — only the wiring to it was lost. Call it.
        //
        // The result must never be `undefined`: `JSON.stringify(undefined)` is
        // not a string, which strips the required `content` off
        // TOOL_CALL_RESULT and surfaces as a Zod error in the browser
        // (#2915, #3198). Both branches below return a string instead.
        execute: async (args: unknown) => {
          if (typeof action.handler !== "function") {
            return (
              `The tool "${action.name}" was advertised without a handler, so it ` +
              `has no implementation to run. Tell the user this tool is unavailable.`
            );
          }
          const result = await action.handler(args as any);
          return result === undefined
            ? `The tool "${action.name}" ran and returned no value.`
            : result;
        },
      };
    });
  }

  private assignToolsToAgents(
    agents: Record<string, AbstractAgent>,
    tools: BuiltInAgentClassicConfig["tools"],
  ): Record<string, AbstractAgent> {
    if (!tools?.length) {
      return agents;
    }

    const enrichedAgents: Record<string, AbstractAgent> = { ...agents };

    for (const [agentId, agent] of Object.entries(enrichedAgents)) {
      const existingConfig = (Reflect.get(agent, "config") ?? {}) as Record<
        string,
        unknown
      >;

      // Skip factory-mode agents — they don't have a tools property
      if ("factory" in existingConfig) {
        continue;
      }

      const classicConfig =
        existingConfig as unknown as BuiltInAgentClassicConfig;
      const existingTools = classicConfig.tools ?? [];

      // The endpoint factory runs `handleServiceAdapter` every time it is
      // called, and the documented v1 route builds the endpoint inside the
      // request handler — so a module-scope runtime lands here once per
      // request. Appending unconditionally advertised N copies of every tool
      // to the model. Skip names the agent already carries, which also leaves
      // a tool the agent defines itself in place.
      const existingNames = new Set(existingTools.map((tool) => tool.name));
      const newTools = tools.filter((tool) => !existingNames.has(tool.name));
      if (newTools.length === 0) {
        continue;
      }

      const updatedConfig: BuiltInAgentClassicConfig = {
        ...classicConfig,
        tools: [...existingTools, ...newTools],
      };

      Reflect.set(agent, "config", updatedConfig);
      enrichedAgents[agentId] = agent;
    }

    return enrichedAgents;
  }

  private createOnBeforeRequestHandler(
    params?: CopilotRuntimeConstructorParams<T> &
      PartialBy<CopilotRuntimeOptions, "agents">,
  ) {
    return async (hookParams: BeforeRequestMiddlewareFnParameters[0]) => {
      const { request } = hookParams;

      // Capture telemetry for copilot request creation
      const publicApiKey = request.headers.get("x-copilotcloud-public-api-key");
      const body = (await readBody(request)) as RunAgentInput;

      const forwardedProps = body?.forwardedProps as
        | {
            cloud?: { guardrails?: unknown };
            metadata?: { requestType?: string };
          }
        | undefined;

      // Get cloud base URL from environment or default
      const cloudBaseUrl =
        process.env.COPILOT_CLOUD_BASE_URL || "https://api.cloud.copilotkit.ai";

      this.telemetry.capture("oss.runtime.copilot_request_created", {
        "cloud.guardrails.enabled":
          forwardedProps?.cloud?.guardrails !== undefined,
        requestType: forwardedProps?.metadata?.requestType ?? "unknown",
        "cloud.api_key_provided": !!publicApiKey,
        ...(publicApiKey ? { "cloud.public_api_key": publicApiKey } : {}),
        "cloud.base_url": cloudBaseUrl,
      });

      // We do not process middleware for the internal GET requests
      if (request.method === "GET" || !body) return;

      // TODO: get public api key and run with expected data
      // if (this.observability?.enabled && this.params.publicApiKey) {
      //   this.logObservabilityBeforeRequest()
      // }

      // TODO: replace hooksParams top argument type with BeforeRequestMiddlewareParameters when exported
      const middlewareResult =
        await params?.beforeRequestMiddleware?.(hookParams);

      if (params?.middleware?.onBeforeRequest) {
        const { request, runtime, path } = hookParams;
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

      return middlewareResult;
    };
  }

  private createOnAfterRequestHandler(
    params?: CopilotRuntimeConstructorParams<T> &
      PartialBy<CopilotRuntimeOptions, "agents">,
  ) {
    return async (hookParams: AfterRequestMiddlewareFnParameters[0]) => {
      // TODO: get public api key and run with expected data
      // if (this.observability?.enabled && publicApiKey) {
      //   this.logObservabilityAfterRequest()
      // }

      // TODO: replace hooksParams top argument type with AfterRequestMiddlewareParameters when exported
      params?.afterRequestMiddleware?.(hookParams);

      if (params?.middleware?.onAfterRequest) {
        const messages = hookParams.messages ?? [];
        params.middleware.onAfterRequest({
          threadId: hookParams.threadId ?? "",
          runId: hookParams.runId,
          inputMessages: messages.filter(
            (m): m is typeof m & { role: string } =>
              "role" in m && m.role === "user",
          ) as unknown as Message[],
          outputMessages: messages.filter(
            (m): m is typeof m & { role: string } =>
              "role" in m && m.role !== "user",
          ) as unknown as Message[],
          // TODO: forward actual properties once the after-request hook has access to the request body
          properties: {},
          url: hookParams.path,
        } satisfies OnAfterRequestOptions);
      }
    };
  }

  // Observability Methods

  /**
   * Log LLM request if observability is enabled
   */
  private async logObservabilityBeforeRequest(
    requestData: LLMRequestData,
  ): Promise<void> {
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
            output: this.observability.progressive
              ? streamedChunks
              : outputMessages,
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

  // Resolve MCP tools to BuiltInAgent tool definitions
  // Optionally accepts request-scoped properties to merge request-provided mcpServers
  private async getToolsFromMCP(options?: {
    properties?: Record<string, unknown>;
  }): Promise<BuiltInAgentClassicConfig["tools"]> {
    const runtimeMcpServers = (this.params?.mcpServers ??
      []) as MCPEndpointConfig[];
    const createMCPClient = this.params?.createMCPClient as
      | CreateMCPClientFunction
      | undefined;

    // If no runtime config and no request overrides, nothing to do
    const requestMcpServers = ((
      options?.properties as { mcpServers?: MCPEndpointConfig[] } | undefined
    )?.mcpServers ??
      (
        options?.properties as
          | { mcpEndpoints?: MCPEndpointConfig[] }
          | undefined
      )?.mcpEndpoints ??
      []) as MCPEndpointConfig[];

    const hasAnyServers =
      (runtimeMcpServers?.length ?? 0) > 0 ||
      (requestMcpServers?.length ?? 0) > 0;
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

    const allTools: BuiltInAgentClassicConfig["tools"] = [];

    for (const config of effectiveEndpoints) {
      const endpointUrl = config.endpoint;

      try {
        // Keyed by the client factory plus the whole config, so two callers
        // with different credentials for one endpoint get one client each.
        // Keying on the URL alone is #2407: the first caller's client served
        // everyone, and the reporter's `?uid=<hash>` workaround existed only
        // to force distinct keys.
        const entry = await resolveMCPEntry<BuiltInAgentClassicConfig["tools"]>(
          createMCPClient,
          config,
          async () => {
            const client = await createMCPClient(config);
            const toolsMap = await client.tools();

            const toolDefs: BuiltInAgentClassicConfig["tools"] = Object.entries(
              toolsMap,
            ).map(([toolName, tool]: [string, MCPTool]) => {
              const params: Parameter[] = extractParametersFromSchema(tool);
              const zodSchema = getZodParameters(params);
              return {
                name: toolName,
                description:
                  tool.description ||
                  `MCP tool: ${toolName} (from ${endpointUrl})`,
                parameters: zodSchema,
                // The MCP client stays live for the lifetime of the cached
                // tool definitions; `tool.execute` calls the server.
                execute: async (args: unknown) => tool.execute(args),
              };
            });

            return { client, tools: toolDefs };
          },
        );

        allTools.push(...(entry.tools ?? []));
      } catch (error) {
        console.error(
          `MCP: Failed to fetch tools from endpoint ${endpointUrl}. Skipping. Error:`,
          error,
        );
        // Deliberately not cached. Caching the empty result meant a server
        // that was briefly unreachable when the runtime first resolved stayed
        // toolless for the life of that runtime, even after it recovered.
        // `resolveMCPEntry` drops a rejected entry so a later request retries.
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
export function copilotKitEndpoint(
  config: Omit<CopilotKitEndpoint, "type">,
): CopilotKitEndpoint {
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
