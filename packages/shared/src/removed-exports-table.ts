/**
 * The CopilotKit 1.x exports that 2.0 removed, and what to use instead.
 *
 * This table is the one source of the stand-ins: each package has a module,
 * generated from it, that exports a stand-in for each of its names (see
 * `removedApi` and `RemovedType` in ./utils/removed-api.ts). Calling,
 * constructing, or rendering a stand-in throws a `CopilotKitRemovedApiError`
 * with the message that `removedApiMessage` builds from the entry. The
 * packages do not import this file; it is not part of the published code.
 *
 * After you change it, run
 * `pnpm exec tsx scripts/deprecations/removed-exports.mts generate`.
 * `scripts/__tests__/removed-exports*.test.ts` check that each `docs` section
 * exists, and that the table covers each name that 2.0 removed.
 */
import type { CopilotKitDocsSection } from "./utils/errors";

/** What to use in place of a removed export. */
export interface RemovedExport {
  /** What to use instead, as one or more full sentences. */
  use: string;
  /** The docs section about the replacement. */
  docs: CopilotKitDocsSection;
}

/* Docs sections ------------------------------------------------------------ */

const HOOK_MAPPING = "/migrate/v2#hook-mapping";
const PROVIDER = "/migrate/v2#update-the-provider-and-hook-imports";
const REACT_UI = "/migrate/v2#replace-react-ui-imports";
const UPDATE_RUNTIME = "/migrate/v2#update-the-runtime";
const ZOD = "/migrate/v2#upgrade-to-zod-42-or-later";
const VUE = "/migrate/v2#if-you-use-vue-update-vue-imports";
const GOTCHAS = "/migrate/v2#gotchas";
const PROGRAMMATIC_RUN = "/programmatic-control#sending-a-message-from-code";
const THREAD_LISTS = "/migrate/chat-2.0#thread-lists";
const CHAT_REMOVED_EXPORTS = "/migrate/chat-2.0#removed-exports";
const MARKDOWN_RENDERER =
  "/markdown-rendering#option-3--replace-the-renderer-escape-hatch";
const A2UI_RENDERER = "/migrate/generative-ui-2.0#a2ui-v09-renderer";
const SHOW_DEV_CONSOLE = "/migrate/removed-apis-2.0#showdevconsole";
const REMOVED_RUNTIME_APIS = "/migrate/removed-apis-2.0#runtime";
const IMAGE_DATA =
  "/migrate/removed-apis-2.0#message-types-from-copilotkitshared";
const SHARED_HELPERS = "/migrate/shared-2.0#removed-helpers";
const TELEMETRY = "/migrate/shared-2.0#telemetry-entry-point-removed";
const LANGGRAPH_AGENTS = "/migrate/agents-2.0#langgraph-agents";
const CUSTOM_EVENT_NAMES = "/migrate/agents-2.0#customeventnames";
const LANGGRAPH_PLATFORM = "/migrate/agents-2.0#langgraph-platform";
const PYTHON_ENDPOINT = "/migrate/agents-2.0#python-sdk-endpoint";
const FETCH_HANDLER = "/migrate/runtime-2.0#fetch-and-nextjs";
const NODE_LISTENER = "/migrate/runtime-2.0#node-and-express";
const SINGLE_ROUTE = "/migrate/runtime-2.0#single-route-endpoints";
const RENAMED_RUNTIME_EXPORTS = "/migrate/runtime-2.0#renamed-runtime-exports";
const CORS = "/migrate/runtime-2.0#cors-and-lifecycle";
const DEBUG_LOGS = "/migrate/runtime-2.0#debug-logs";
const BUILT_IN_AGENT = "/migrate/runtime-2.0#built-in-agent";
const MCP = "/migrate/runtime-2.0#4-replace-mcpservers-with-mcp";
const RESOLVE_MODEL =
  "/migrate/runtime-2.0#if-you-used-resolvemodel-or-classifymodelspec";

/* Replacements that several names share ------------------------------------ */

const USE_AGENT: RemovedExport = {
  use: "Use useAgent from @copilotkit/react-core. It returns the agent, with its messages and its state.",
  docs: HOOK_MAPPING,
};

const RENDER_AGENT_STATE: RemovedExport = {
  use: "Use useAgent from @copilotkit/react-core, and render agent.state in your component.",
  docs: HOOK_MAPPING,
};

const TOOL_RENDER_PROPS: RemovedExport = {
  use: "TypeScript infers the render props of useFrontendTool, useHumanInTheLoop, and useRenderTool from @copilotkit/react-core from their parameters schema.",
  docs: HOOK_MAPPING,
};

const SUGGESTIONS_CONFIG: RemovedExport = {
  use: "Use SuggestionsConfig from @copilotkit/react-core, the argument of useConfigureSuggestions.",
  docs: HOOK_MAPPING,
};

const INTERRUPT_TYPES: RemovedExport = {
  use: "Use useInterrupt from @copilotkit/react-core, with its UseInterruptConfig, InterruptRenderProps, and InterruptHandlerProps types.",
  docs: HOOK_MAPPING,
};

const AGENT_CONTEXT: RemovedExport = {
  use: "Pass the data to useAgentContext from @copilotkit/react-core.",
  docs: HOOK_MAPPING,
};

const CREWS_STATE: RemovedExport = {
  use: "Read the agent state with useAgent from @copilotkit/react-core, and declare its type in your app.",
  docs: HOOK_MAPPING,
};

const CHAT_PROPS: RemovedExport = {
  use: "Configure the chat with the props and slots of CopilotChat from @copilotkit/react-core.",
  docs: REACT_UI,
};

const RUN_AGENT_FROM_CODE: RemovedExport = {
  use: "Run the agent from code: add a message with agent.addMessage from useAgent, then call copilotkit.runAgent({ agent }) from useCopilotKit, both from @copilotkit/react-core.",
  docs: PROGRAMMATIC_RUN,
};

const THREADS: RemovedExport = {
  use: "Use useThreads from @copilotkit/react-core.",
  docs: THREAD_LISTS,
};

const LEARNING_CONTAINERS: RemovedExport = {
  use: "Set getLearningContainerId on CopilotKitIntelligence from @copilotkit/runtime.",
  docs: CHAT_REMOVED_EXPORTS,
};

const REACT_A2UI: RemovedExport = {
  use: "The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass generativeUI={{ ui }} with a UI from createGenerativeUI in @copilotkit/react-core/generative-ui.",
  docs: A2UI_RENDERER,
};

const VUE_A2UI: RemovedExport = {
  use: 'The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass :generativeUI="{ ui }" with a UI from createGenerativeUI in @copilotkit/vue/generative-ui.',
  docs: A2UI_RENDERER,
};

const ANGULAR_A2UI: RemovedExport = {
  use: "The A2UI v0.9 renderer was removed, and the chat renders A2UI with generative UI. Add provideGenerativeUI({ ui }) from @copilotkit/angular/generative-ui next to provideCopilotKit, with a UI from createGenerativeUI.",
  docs: A2UI_RENDERER,
};

const A2UI_CATALOG_HELPERS: RemovedExport = {
  use: "The A2UI v0.9 catalog helpers were removed. Declare the components with createGenerativeUI, and get the catalog schema with exportA2UICatalog(ui), both from the /generative-ui entry of your framework package.",
  docs: A2UI_RENDERER,
};

const SERVICE_ADAPTER: RemovedExport = {
  use: 'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  docs: UPDATE_RUNTIME,
};

const NO_ADAPTER_NEEDED: RemovedExport = {
  use: "CopilotKit 2.0 needs no service adapter. Delete it, and pass your agents in agents on CopilotKitRuntime from @copilotkit/runtime.",
  docs: UPDATE_RUNTIME,
};

const NO_GRAPHQL: RemovedExport = {
  use: "CopilotKit 2.0 has no GraphQL endpoint. Serve the runtime with createCopilotKitRuntimeHandler from @copilotkit/runtime.",
  docs: UPDATE_RUNTIME,
};

const GRAPHQL_CONTEXT: RemovedExport = {
  use: "CopilotKit 2.0 has no GraphQL endpoint. Read the request in the hooks option of createCopilotKitRuntimeHandler (CopilotKitRuntimeHooks from @copilotkit/runtime).",
  docs: UPDATE_RUNTIME,
};

const GRAPHQL_RESPONSE: RemovedExport = {
  use: "CopilotKit 2.0 has no GraphQL endpoint. A failed run reaches the frontend as an AG-UI RUN_ERROR event.",
  docs: UPDATE_RUNTIME,
};

const MCP_CLIENT: RemovedExport = {
  use: "Create the MCP client with createMCPClient from @tanstack/ai-mcp, and pass it to a BuiltInAgent as mcp: { clients: [client] }.",
  docs: MCP,
};

const MCP_TYPES: RemovedExport = {
  use: "Import the MCP client types from @tanstack/ai-mcp, and pass each client to a BuiltInAgent as mcp: { clients: [client] }.",
  docs: MCP,
};

const FETCH_HANDLER_FACTORY: RemovedExport = {
  use: "Use createCopilotKitRuntimeHandler from @copilotkit/runtime. In Hono, pass it c.req.raw.",
  docs: FETCH_HANDLER,
};

const EXPRESS_FACTORY: RemovedExport = {
  use: "Mount createCopilotKitNodeListener from @copilotkit/runtime/node in your Express app.",
  docs: NODE_LISTENER,
};

const MODEL_SPEC: RemovedExport = {
  use: "Use AnyTextAdapter from @tanstack/ai: the model of a BuiltInAgent is a TanStack AI text adapter.",
  docs: BUILT_IN_AGENT,
};

const MODEL_RESOLVER: RemovedExport = {
  use: 'Pass an adapter as model, for example anthropicText("claude-sonnet-4-6"). To switch models from the frontend, set the resolveModel option of the BuiltInAgent.',
  docs: RESOLVE_MODEL,
};

const AI_SDK_HELPER: RemovedExport = {
  use: "2.0 exports the AI SDK helpers from @copilotkit/runtime/agent/ai-sdk. Import it from there, and add the ai package to your app.",
  docs: BUILT_IN_AGENT,
};

const RUNTIME_LOGGER: RemovedExport = {
  use: "Pass a logger (CopilotKitRuntimeLogger) to CopilotKitRuntime from @copilotkit/runtime, or set debug: true for debug logs.",
  docs: DEBUG_LOGS,
};

const TELEMETRY_RUNNER: RemovedExport = {
  use: "Delete the wrapper, and pass your runner as runner on CopilotKitRuntime. The runtime reports telemetry by itself.",
  docs: TELEMETRY,
};

const VERSION_CHECK: RemovedExport = {
  use: "Delete the code. CopilotKit 2.0 has no GraphQL runtime client to compare versions with.",
  docs: SHARED_HELPERS,
};

const CONDITIONS: RemovedExport = {
  use: "Delete the code, or keep your own copy of it.",
  docs: SHARED_HELPERS,
};

const CONSOLE_STYLES: RemovedExport = {
  use: "Delete the code, or use console.log with %c styles.",
  docs: SHARED_HELPERS,
};

const UUID: RemovedExport = {
  use: "Use v5 and validate from the uuid package.",
  docs: SHARED_HELPERS,
};

const TELEMETRY_TYPES: RemovedExport = {
  use: "Delete the import. @copilotkit/runtime has its own telemetry client.",
  docs: TELEMETRY,
};

const VUE_FRONTEND_TOOL: RemovedExport = {
  use: "Use VueFrontendTool from @copilotkit/vue. Its parameters is a Zod schema, and available is a boolean.",
  docs: VUE,
};

/**
 * The stand-ins, by the 2.0 module that exports them. A 1.x `/v2` subpath is
 * a deprecated alias of its 2.0 entry, so the stand-ins for the names that
 * `@copilotkit/react-core/v2` lost are in `@copilotkit/react-core`.
 */
export const REMOVED_EXPORTS: Record<string, Record<string, RemovedExport>> = {
  "@copilotkit/react-core": {
    // Hooks
    useCopilotAction: {
      use: "Use useFrontendTool from @copilotkit/react-core (parameters are now a Zod 4 / Standard Schema), or useHumanInTheLoop when the action waits for the user.",
      docs: HOOK_MAPPING,
    },
    useCopilotReadable: {
      use: "Use useAgentContext from @copilotkit/react-core.",
      docs: HOOK_MAPPING,
    },
    useCopilotAdditionalInstructions: {
      use: "Use useAgentContext from @copilotkit/react-core to give the agent the instructions.",
      docs: HOOK_MAPPING,
    },
    useMakeCopilotDocumentReadable: {
      use: "Use useAgentContext from @copilotkit/react-core, with the document text as the value.",
      docs: HOOK_MAPPING,
    },
    useCoAgent: USE_AGENT,
    useCoAgentStateRender: RENDER_AGENT_STATE,
    useCoAgentStateRenders: RENDER_AGENT_STATE,
    useCopilotChat: {
      use: "Use useAgent from @copilotkit/react-core. It returns the agent with its messages. For a chat UI of your own, see Headless UI.",
      docs: HOOK_MAPPING,
    },
    useCopilotChatHeadless_c: USE_AGENT,
    useCopilotChatInternal: USE_AGENT,
    useCopilotChatSuggestions: {
      use: "Use useConfigureSuggestions from @copilotkit/react-core.",
      docs: HOOK_MAPPING,
    },
    useLangGraphInterrupt: {
      use: "Use useInterrupt from @copilotkit/react-core.",
      docs: HOOK_MAPPING,
    },
    useDefaultTool: {
      use: "Use useDefaultRenderTool from @copilotkit/react-core.",
      docs: HOOK_MAPPING,
    },
    useLazyToolRenderer: {
      use: "Use useRenderToolCall from @copilotkit/react-core. It returns a function that renders a tool call.",
      docs: GOTCHAS,
    },
    useCopilotContext: {
      use: "Use useCopilotKit from @copilotkit/react-core. It returns the CopilotKit core.",
      docs: PROGRAMMATIC_RUN,
    },
    useCopilotMessagesContext: {
      use: "Read agent.messages from useAgent from @copilotkit/react-core.",
      docs: HOOK_MAPPING,
    },
    useCopilotRuntimeClient: {
      use: "CopilotKit 2.0 has no GraphQL runtime client. Use useAgent or useCopilotKit from @copilotkit/react-core.",
      docs: UPDATE_RUNTIME,
    },
    useCopilotAuthenticatedAction_c: {
      use: "Use useFrontendTool from @copilotkit/react-core, and check the user in its handler.",
      docs: HOOK_MAPPING,
    },
    // Components and functions
    shouldShowDevConsole: {
      use: "Delete the call. To turn the Inspector on or off, set enableInspector on CopilotKitProvider.",
      docs: SHOW_DEV_CONSOLE,
    },
    CoAgentStateRendersProvider: {
      use: "Delete it. Render agent.state from useAgent from @copilotkit/react-core in your component.",
      docs: HOOK_MAPPING,
    },
    ThreadsProvider: {
      use: "Delete it. Pass threadId to CopilotChat (or to CopilotChatConfigurationProvider around the chat), and list the threads with useThreads, from @copilotkit/react-core.",
      docs: THREAD_LISTS,
    },
    CopilotTask: RUN_AGENT_FROM_CODE,
    createA2UIMessageRenderer: REACT_A2UI,
    useLearningContainers: LEARNING_CONTAINERS,
    useLearningContainersInCurrentThread: LEARNING_CONTAINERS,
    // Types
    ActionRenderProps: TOOL_RENDER_PROPS,
    ActionRenderPropsNoArgs: TOOL_RENDER_PROPS,
    ActionRenderPropsNoArgsWait: TOOL_RENDER_PROPS,
    ActionRenderPropsWait: TOOL_RENDER_PROPS,
    CatchAllActionRenderProps: TOOL_RENDER_PROPS,
    CatchAllActionRenderPropsWait: TOOL_RENDER_PROPS,
    RenderFunctionStatus: {
      use: "Use ToolCallStatus from @copilotkit/react-core.",
      docs: HOOK_MAPPING,
    },
    FrontendAction: {
      use: "Use ReactFrontendTool from @copilotkit/react-core, the argument of useFrontendTool. Its parameters is a Zod 4 / Standard Schema.",
      docs: HOOK_MAPPING,
    },
    CatchAllFrontendAction: {
      use: 'Register a renderer for every tool with useRenderTool({ name: "*", render }) from @copilotkit/react-core.',
      docs: HOOK_MAPPING,
    },
    FrontendActionAvailability: {
      use: "Set available on useFrontendTool from @copilotkit/react-core to true or false.",
      docs: HOOK_MAPPING,
    },
    ChatSuggestions: SUGGESTIONS_CONFIG,
    CopilotChatSuggestionConfiguration: SUGGESTIONS_CONFIG,
    UseCopilotChatSuggestionsConfiguration: SUGGESTIONS_CONFIG,
    CoagentInChatRenderFunction: RENDER_AGENT_STATE,
    CoAgentStateRendersContextValue: RENDER_AGENT_STATE,
    CopilotApiConfig: {
      use: "Pass runtimeUrl and headers to CopilotKitProvider from @copilotkit/react-core.",
      docs: PROVIDER,
    },
    CopilotContextParams: {
      use: "Use useCopilotKit from @copilotkit/react-core. It returns the CopilotKit core.",
      docs: PROGRAMMATIC_RUN,
    },
    CopilotMessagesContextParams: {
      use: "Read agent.messages from useAgent from @copilotkit/react-core.",
      docs: HOOK_MAPPING,
    },
    CopilotTaskConfig: RUN_AGENT_FROM_CODE,
    CrewsAgentState: CREWS_STATE,
    CrewsResponse: CREWS_STATE,
    CrewsResponseStatus: CREWS_STATE,
    CrewsStateItem: CREWS_STATE,
    CrewsTaskStateItem: CREWS_STATE,
    CrewsToolStateItem: CREWS_STATE,
    DocumentPointer: AGENT_CONTEXT,
    Tree: AGENT_CONTEXT,
    TreeNode: AGENT_CONTEXT,
    HintFunction: RUN_AGENT_FROM_CODE,
    SystemMessageFunction: {
      use: "Give the agent its instructions in the agent, or with useAgentContext from @copilotkit/react-core.",
      docs: HOOK_MAPPING,
    },
    OnReloadMessages: CHAT_PROPS,
    OnStopGeneration: CHAT_PROPS,
    LangGraphInterruptAction: INTERRUPT_TYPES,
    LangGraphInterruptActionSetter: INTERRUPT_TYPES,
    LangGraphInterruptActionSetterArgs: INTERRUPT_TYPES,
    LangGraphInterruptRender: INTERRUPT_TYPES,
    LangGraphInterruptRenderHandlerProps: INTERRUPT_TYPES,
    LangGraphInterruptRenderProps: INTERRUPT_TYPES,
    QueuedInterruptEvent: INTERRUPT_TYPES,
    ThreadsContextValue: THREADS,
    ThreadsProviderProps: THREADS,
    UseCopilotChatOptions: USE_AGENT,
    UseCopilotChatOptions_c: USE_AGENT,
    UseCopilotChatReturn: USE_AGENT,
    UseCopilotChatReturn_c: USE_AGENT,
    A2UIActionInterceptor: REACT_A2UI,
    A2UIMessageRendererOptions: REACT_A2UI,
    A2UIRecoveryRendererOptions: REACT_A2UI,
    A2UITheme: REACT_A2UI,
    A2UIUserAction: REACT_A2UI,
    UseLearningContainersArgs: LEARNING_CONTAINERS,
    UseLearningContainersInCurrentThreadArgs: LEARNING_CONTAINERS,
  },

  "@copilotkit/runtime": {
    CopilotRuntime: {
      use: "Use CopilotKitRuntime from @copilotkit/runtime, and pass each agent in agents. A model runs in a BuiltInAgent from @copilotkit/runtime/agent, so serviceAdapter, remoteEndpoints, and actions are gone.",
      docs: UPDATE_RUNTIME,
    },
    CopilotRuntimeConstructorParams_BASE: {
      use: "Use CopilotKitRuntimeOptions from @copilotkit/runtime.",
      docs: UPDATE_RUNTIME,
    },
    CopilotRuntimeLogger: {
      use: "Use CopilotKitRuntimeLogger from @copilotkit/runtime.",
      docs: RENAMED_RUNTIME_EXPORTS,
    },
    // Service adapters
    AnthropicAdapter: SERVICE_ADAPTER,
    AnthropicAdapterParams: SERVICE_ADAPTER,
    AnthropicPromptCachingConfig: SERVICE_ADAPTER,
    BedrockAdapter: SERVICE_ADAPTER,
    BedrockAdapterParams: SERVICE_ADAPTER,
    GoogleGenerativeAIAdapter: SERVICE_ADAPTER,
    GroqAdapter: SERVICE_ADAPTER,
    GroqAdapterParams: SERVICE_ADAPTER,
    LangChainAdapter: SERVICE_ADAPTER,
    OpenAIAdapter: SERVICE_ADAPTER,
    OpenAIAdapterParams: SERVICE_ADAPTER,
    OpenAIAssistantAdapter: SERVICE_ADAPTER,
    OpenAIAssistantAdapterParams: SERVICE_ADAPTER,
    UnifyAdapter: SERVICE_ADAPTER,
    UnifyAdapterParams: SERVICE_ADAPTER,
    ExperimentalOllamaAdapter: SERVICE_ADAPTER,
    RemoteChain: SERVICE_ADAPTER,
    RemoteChainParameters: SERVICE_ADAPTER,
    CopilotServiceAdapter: SERVICE_ADAPTER,
    CopilotRuntimeChatCompletionRequest: SERVICE_ADAPTER,
    CopilotRuntimeChatCompletionResponse: SERVICE_ADAPTER,
    convertServiceAdapterError: SERVICE_ADAPTER,
    getCommonConfig: SERVICE_ADAPTER,
    CommonConfig: SERVICE_ADAPTER,
    getSdkClientOptions: SERVICE_ADAPTER,
    SdkClientLike: SERVICE_ADAPTER,
    FilterThinkingTextBuffer: SERVICE_ADAPTER,
    EmptyAdapter: NO_ADAPTER_NEEDED,
    ExperimentalEmptyAdapter: NO_ADAPTER_NEEDED,
    // Endpoints
    copilotRuntimeNextJSAppRouterEndpoint: {
      use: "Serve the runtime with createCopilotKitRuntimeHandler from @copilotkit/runtime, and export the handler as GET and POST from app/api/copilotkit/[[...slug]]/route.ts.",
      docs: FETCH_HANDLER,
    },
    copilotRuntimeNextJSPagesRouterEndpoint: {
      use: "Serve the runtime with createCopilotKitNodeHandler from @copilotkit/runtime/node.",
      docs: NODE_LISTENER,
    },
    copilotRuntimeNodeHttpEndpoint: {
      use: "Serve the runtime with createCopilotKitNodeListener from @copilotkit/runtime/node.",
      docs: NODE_LISTENER,
    },
    copilotRuntimeNodeExpressEndpoint: EXPRESS_FACTORY,
    copilotRuntimeNestEndpoint: EXPRESS_FACTORY,
    CreateCopilotRuntimeServerOptions: {
      use: "Use CopilotKitRuntimeHandlerOptions from @copilotkit/runtime.",
      docs: FETCH_HANDLER,
    },
    CopilotEndpointCorsConfig: {
      use: "Use CopilotKitCorsConfig from @copilotkit/runtime, the cors option of createCopilotKitRuntimeHandler.",
      docs: CORS,
    },
    toFetchCorsConfig: {
      use: "Pass a CopilotKitCorsConfig as the cors option of createCopilotKitRuntimeHandler from @copilotkit/runtime.",
      docs: CORS,
    },
    createCopilotEndpoint: FETCH_HANDLER_FACTORY,
    createCopilotHonoHandler: FETCH_HANDLER_FACTORY,
    CopilotHonoApp: FETCH_HANDLER_FACTORY,
    createCopilotEndpointExpress: EXPRESS_FACTORY,
    createCopilotExpressHandler: EXPRESS_FACTORY,
    CopilotExpressEndpointParams: EXPRESS_FACTORY,
    CopilotExpressRouter: EXPRESS_FACTORY,
    createCopilotEndpointSingleRoute: {
      use: 'Use createCopilotKitRuntimeHandler from @copilotkit/runtime with mode: "single-route".',
      docs: SINGLE_ROUTE,
    },
    createCopilotEndpointSingleRouteExpress: {
      use: 'Use createCopilotKitNodeListener from @copilotkit/runtime/node with mode: "single-route".',
      docs: SINGLE_ROUTE,
    },
    CopilotKitRequestHandler: {
      use: "Use CopilotKitRuntimeFetchHandler from @copilotkit/runtime. It takes the Request directly.",
      docs: REMOVED_RUNTIME_APIS,
    },
    // GraphQL
    buildSchema: NO_GRAPHQL,
    CopilotRequestContextProperties: GRAPHQL_CONTEXT,
    GraphQLContext: GRAPHQL_CONTEXT,
    GraphQLRequestContext: GRAPHQL_CONTEXT,
    GuardrailsValidationFailureResponse: GRAPHQL_RESPONSE,
    MessageStreamInterruptedResponse: GRAPHQL_RESPONSE,
    UnknownErrorResponse: GRAPHQL_RESPONSE,
    // Agents and remote endpoints
    BasicAgent: {
      use: "Use BuiltInAgent from @copilotkit/runtime/agent.",
      docs: REMOVED_RUNTIME_APIS,
    },
    BasicAgentConfiguration: {
      use: "Use BuiltInAgentClassicConfig from @copilotkit/runtime/agent.",
      docs: REMOVED_RUNTIME_APIS,
    },
    BuiltInAgentModel: MODEL_SPEC,
    ModelSpecifier: MODEL_SPEC,
    classifyModelSpec: MODEL_RESOLVER,
    resolveModel: MODEL_RESOLVER,
    LangGraphAgent: {
      use: "Import LangGraphAgent from @ag-ui/langgraph. The constructor options are the same.",
      docs: LANGGRAPH_AGENTS,
    },
    LangGraphHttpAgent: {
      use: "Import LangGraphHttpAgent from @ag-ui/langgraph. The constructor options are the same.",
      docs: LANGGRAPH_AGENTS,
    },
    CustomEventNames: {
      use: "Import CustomEventNames from @ag-ui/langgraph. Its members have new names and values.",
      docs: CUSTOM_EVENT_NAMES,
    },
    PredictStateTool: {
      use: "Import PredictStateTool from @ag-ui/langgraph.",
      docs: LANGGRAPH_AGENTS,
    },
    TextMessageEvents: {
      use: "Import the AG-UI event types, such as TextMessageStartEvent, from @ag-ui/client.",
      docs: LANGGRAPH_AGENTS,
    },
    ToolCallEvents: {
      use: "Import the AG-UI event types, such as ToolCallStartEvent, from @ag-ui/client.",
      docs: LANGGRAPH_AGENTS,
    },
    langGraphPlatformEndpoint: {
      use: "CopilotKitRuntime has no remoteEndpoints. Create a LangGraphAgent from @ag-ui/langgraph for each agent, and pass it in agents.",
      docs: LANGGRAPH_PLATFORM,
    },
    copilotKitEndpoint: {
      use: "CopilotKitRuntime has no remoteEndpoints. Serve each Python agent over AG-UI, and register it in agents.",
      docs: PYTHON_ENDPOINT,
    },
    resolveEndpointType: {
      use: "CopilotKitRuntime has no remoteEndpoints. Register each agent in agents on CopilotKitRuntime from @copilotkit/runtime.",
      docs: LANGGRAPH_PLATFORM,
    },
    isA2UIEnabled: {
      use: 'The runtime a2ui option is now generativeUI: { a2uiVersion: "0.9" }. Read generativeUI on your runtime options.',
      docs: A2UI_RENDERER,
    },
    // AI SDK helpers, which 2.0 exports from @copilotkit/runtime/agent/ai-sdk
    convertJsonSchemaToZodSchema: AI_SDK_HELPER,
    convertMessagesToVercelAISDKMessages: AI_SDK_HELPER,
    convertToolDefinitionsToVercelAITools: AI_SDK_HELPER,
    convertToolsToVercelAITools: AI_SDK_HELPER,
    MessageConversionOptions: AI_SDK_HELPER,
    createSafeUrlDownload: AI_SDK_HELPER,
    CreateSafeUrlDownloadOptions: AI_SDK_HELPER,
    SafeUrlDownloadOptions: AI_SDK_HELPER,
    // MCP
    MCPClient: MCP_TYPES,
    MCPClientConfig: MCP_TYPES,
    MCPClientConfigHTTP: MCP_TYPES,
    MCPClientConfigSSE: MCP_TYPES,
    MCPClientProvider: MCP_TYPES,
    MCPTransport: MCP_TYPES,
    MCPEndpointConfig: MCP_TYPES,
    MCPTool: MCP_TYPES,
    convertMCPToolsToActions: MCP_CLIENT,
    extractParametersFromSchema: MCP_CLIENT,
    generateMcpToolInstructions: MCP_CLIENT,
    // Logs and telemetry
    createLogger: RUNTIME_LOGGER,
    LogLevel: RUNTIME_LOGGER,
    TelemetryAgentRunner: TELEMETRY_RUNNER,
    TelemetryAgentRunnerConfig: TELEMETRY_RUNNER,
  },

  "@copilotkit/shared": {
    CopilotKitVersionMismatchError: VERSION_CHECK,
    getPossibleVersionMismatch: VERSION_CHECK,
    executeConditions: CONDITIONS,
    BaseCondition: CONDITIONS,
    ComparisonCondition: CONDITIONS,
    ComparisonRule: CONDITIONS,
    Condition: CONDITIONS,
    ExistenceCondition: CONDITIONS,
    ExistenceRule: CONDITIONS,
    LogicalCondition: CONDITIONS,
    LogicalRule: CONDITIONS,
    Rule: CONDITIONS,
    logStyled: CONSOLE_STYLES,
    logCopilotKitPlatformMessage: CONSOLE_STYLES,
    publicApiKeyRequired: CONSOLE_STYLES,
    dataToUUID: UUID,
    isValidUUID: UUID,
    convertJsonSchemaToZodSchema: {
      use: "Keep your own copy of the function, or import it from @copilotkit/runtime/agent/ai-sdk on the server.",
      docs: SHARED_HELPERS,
    },
    getZodParameters: {
      use: "Keep your own copy of the function. For the JSON Schema of a v1 Parameter[], use actionParametersToJsonSchema from @copilotkit/shared.",
      docs: SHARED_HELPERS,
    },
    ImageData: {
      use: "Put an ImageInputPart from @copilotkit/shared in the content of the user message.",
      docs: IMAGE_DATA,
    },
    TelemetryCapture: TELEMETRY_TYPES,
    TelemetryIdentity: TELEMETRY_TYPES,
    SchemaToJsonSchemaOptions: {
      use: "schemaToJsonSchema from @copilotkit/shared takes no options. It reads the JSON Schema from the schema, which needs Zod 4.2 or later.",
      docs: ZOD,
    },
    A2UICatalogSchemaSource: A2UI_CATALOG_HELPERS,
    A2UICommonTypes: A2UI_CATALOG_HELPERS,
    A2UIFunctionSchema: A2UI_CATALOG_HELPERS,
    A2UIInlineCatalogSchema: A2UI_CATALOG_HELPERS,
    A2UIRuntimeInfo: A2UI_CATALOG_HELPERS,
    buildA2UICatalogContextValue: A2UI_CATALOG_HELPERS,
    extractA2UICatalogSchemas: A2UI_CATALOG_HELPERS,
    serializeA2UISchema: A2UI_CATALOG_HELPERS,
  },

  "@copilotkit/vue": {
    useCopilotAction: {
      use: "Use useFrontendTool from @copilotkit/vue (parameters are now a Zod 4 / Standard Schema), useHumanInTheLoop for renderAndWaitForResponse, or useRenderTool for an action that only renders.",
      docs: VUE,
    },
    useCopilotReadable: {
      use: "Use useAgentContext from @copilotkit/vue. To keep the context current, pass a ref, a getter, or a reactive object as the value.",
      docs: VUE,
    },
    FrontendAction: VUE_FRONTEND_TOOL,
    UseFrontendToolArgs: VUE_FRONTEND_TOOL,
    CatchAllFrontendAction: {
      use: 'Register the renderer with useRenderTool({ name: "*", render }) from @copilotkit/vue.',
      docs: VUE,
    },
    UseCopilotReadableOptions: {
      use: "Use AgentContextInput from @copilotkit/vue: { description, value }.",
      docs: VUE,
    },
    useKatexStyles: {
      use: "Delete the import and the call. The 2.0 chat does not render KaTeX math; to render math, plug in a markdown renderer of your own.",
      docs: MARKDOWN_RENDERER,
    },
    A2UIOperation: {
      use: "Import A2UIOperation from @copilotkit/shared.",
      docs: A2UI_RENDERER,
    },
    getOperationSurfaceId: {
      use: "Import getOperationSurfaceId from @copilotkit/shared.",
      docs: A2UI_RENDERER,
    },
    A2UISurfaceActivityRenderer: VUE_A2UI,
    createA2UIMessageRenderer: VUE_A2UI,
    A2UIMessageRendererOptions: VUE_A2UI,
    A2UISurfaceOperationPayload: VUE_A2UI,
    A2UITheme: VUE_A2UI,
  },

  "@copilotkit/angular": {
    CopilotA2UIActivityRenderer: ANGULAR_A2UI,
    CopilotA2UIProgress: ANGULAR_A2UI,
    CopilotA2UIRecovery: ANGULAR_A2UI,
    CopilotA2UIToolRenderer: ANGULAR_A2UI,
    readA2UILifecycleContent: ANGULAR_A2UI,
    A2UICatalog: ANGULAR_A2UI,
    A2UIClientEventMessage: ANGULAR_A2UI,
    A2UIConfig: ANGULAR_A2UI,
    A2UIDebugExposure: ANGULAR_A2UI,
    A2UILifecycleContent: ANGULAR_A2UI,
    A2UILifecycleStatus: ANGULAR_A2UI,
    A2UIRecoveryOptions: ANGULAR_A2UI,
    A2UISurfaceError: ANGULAR_A2UI,
    RenderA2UIArgs: ANGULAR_A2UI,
  },
};

/* Names without a stand-in ------------------------------------------------- */

const REACT_CONTEXT =
  "a React context: React reads it in useContext without a call, so a stand-in cannot throw";
const CONSTANT =
  "a constant: code reads it without a call, so a stand-in cannot throw";
/**
 * 2.0 renamed or moved the name, and the deprecated `/v2` alias exports it
 * again. Until the alias does, the check of the builds accepts these entries;
 * after that, it accepts them as stale.
 */
export const RESTORED_BY_V2_ALIAS =
  "2.0 still has it under another name or entry, and the deprecated /v2 alias exports it again, so it needs no stand-in on /v2";

/** An entry of NOT_STUBBED: each of `names`, with the same `reason`. */
function withReason(reason: string, names: string[]) {
  const reasons: Record<string, string> = {};
  for (const name of names) reasons[name] = reason;
  return reasons;
}

/**
 * The names that a 1.x entrypoint lost in 2.0 and that get no stand-in, by
 * the 1.x import path, with the reason. The script adds the reasons that
 * follow from the 1.x declarations: a name that main added after the last
 * main → 2.0.0 sync, a re-export of an `@ag-ui` package, and a private (ɵ)
 * name.
 */
export const NOT_STUBBED: Record<string, Record<string, string>> = {
  "@copilotkit/react-core": {
    CoAgentStateRendersContext: REACT_CONTEXT,
    CopilotContext: REACT_CONTEXT,
    CopilotMessagesContext: REACT_CONTEXT,
    ThreadsContext: REACT_CONTEXT,
    SUGGESTION_RETRY_CONFIG: CONSTANT,
    defaultCopilotContextCategories: CONSTANT,
  },
  "@copilotkit/react-core/v2": {
    a2uiDefaultTheme: CONSTANT,
  },
  "@copilotkit/runtime": {
    config: CONSTANT,
  },
  // The renamed `Copilot*` names (#8449), and the Built-in Agent names that
  // moved to @copilotkit/runtime/agent. The deprecated /v2 aliases export them
  // again (#8469). The AI SDK helpers stay out of /v2, because their entry
  // loads the optional `ai` package, so they have stand-ins.
  "@copilotkit/runtime/v2": withReason(RESTORED_BY_V2_ALIAS, [
    "CopilotRuntime",
    "CopilotSseRuntime",
    "CopilotIntelligenceRuntime",
    "createCopilotRuntimeHandler",
    "CopilotRuntimeConstructor",
    "CopilotRuntimeOptions",
    "CopilotRuntimeLike",
    "CopilotSseRuntimeOptions",
    "CopilotSseRuntimeLike",
    "CopilotIntelligenceRuntimeOptions",
    "CopilotIntelligenceRuntimeLike",
    "CopilotRuntimeMemoryConfig",
    "CopilotRuntimeUser",
    "CopilotRuntimeLearningConfig",
    "CopilotRuntimeLearningContext",
    "CopilotRuntimeHandlerOptions",
    "CopilotRuntimeFetchHandler",
    "CopilotRuntimeFetchHandlerWithChannels",
    "CopilotRuntimeHooks",
    "CopilotCorsConfig",
    "BuiltInAgent",
    "BuiltInAgentAISDKFactoryConfig",
    "BuiltInAgentClassicConfig",
    "BuiltInAgentConfiguration",
    "BuiltInAgentCustomFactoryConfig",
    "BuiltInAgentFactoryConfig",
    "BuiltInAgentFactoryContext",
    "BuiltInAgentLearnedSkills",
    "BuiltInAgentLearnedSkillsOptions",
    "BuiltInAgentTanStackFactoryConfig",
    "defineTool",
    "InterruptSignal",
    "OverridableProperty",
    "ToolDefinition",
    "convertAISDKStream",
    "convertInputToTanStackAI",
    "convertTanStackStream",
    "TanStackChatMessage",
    "TanStackInputResult",
  ]),
  "@copilotkit/runtime/v2/node": withReason(RESTORED_BY_V2_ALIAS, [
    "createCopilotNodeHandler",
    "createCopilotNodeListener",
    "NodeCopilotListener",
    "NodeCopilotListenerWithChannels",
    "createNodeFetchHandler",
  ]),
  "@copilotkit/shared": {
    A2UI_BASIC_CATALOG_ID: CONSTANT,
    A2UI_SCHEMA_CONTEXT_DESCRIPTION: CONSTANT,
    ConsoleColors: CONSTANT,
    ConsoleStyles: CONSTANT,
    styledConsole: CONSTANT,
  },
  "@copilotkit/vue": {
    A2UIActivityContentSchema: CONSTANT,
    A2UISurfaceActivityType: CONSTANT,
    vueBasicCatalog: CONSTANT,
  },
  "@copilotkit/vue/v2": {
    A2UIActivityContentSchema: CONSTANT,
    A2UISurfaceActivityType: CONSTANT,
    vueBasicCatalog: CONSTANT,
  },
  "@copilotkit/angular": {
    AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME: CONSTANT,
    RENDER_A2UI_TOOL_NAME: CONSTANT,
    RenderA2UIArgsSchema: CONSTANT,
  },
};
