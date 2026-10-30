export interface V1Export {
  typeOnly?: boolean;
  /** The 2.0 export to use instead. Absent when there is none. */
  replacement?: {
    name: string;
    importPath: string;
    docs: string;
    notes?: string[];
  };
  /** Where to read about it when there is no replacement. */
  docs?: string | null;
  notes?: string[];
}

/**
 * Every public export of the v1 entry points, with its 2.0 replacement when
 * there is one. Snapshot of scripts/deprecations/v1-public-api.mjs, taken
 * before v1 was deleted. Do not edit by hand.
 */
export const V1_API: Record<string, Record<string, V1Export>> = {
  "@copilotkit/react-core": {
    ActionRenderProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/generative-ui/tool-rendering",
    },
    ActionRenderPropsNoArgs: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/generative-ui/tool-rendering",
    },
    ActionRenderPropsNoArgsWait: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/generative-ui/tool-rendering",
    },
    ActionRenderPropsWait: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/generative-ui/tool-rendering",
    },
    CatchAllActionRenderProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/generative-ui/tool-rendering",
    },
    CatchAllActionRenderPropsWait: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    CatchAllFrontendAction: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/generative-ui/tool-based",
    },
    ChatSuggestions: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions",
    },
    CoagentInChatRenderFunction: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/generative-ui/state-rendering",
    },
    CoAgentStateRendersContext: {
      docs: "https://docs.copilotkit.ai/generative-ui/state-rendering",
    },
    CoAgentStateRendersContextValue: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/generative-ui/state-rendering",
    },
    CoAgentStateRendersProvider: {
      docs: "https://docs.copilotkit.ai/generative-ui/state-rendering",
    },
    CopilotApiConfig: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    CopilotChatSuggestionConfiguration: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions",
    },
    CopilotContext: {
      docs: "https://docs.copilotkit.ai/reference/v2/components/CopilotKit",
    },
    CopilotContextParams: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2/components/CopilotKit",
    },
    CopilotKit: {
      replacement: {
        name: "CopilotKit",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2/components/CopilotKit",
      },
    },
    CopilotKitProps: {
      typeOnly: true,
      replacement: {
        name: "CopilotKitProps",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2",
      },
    },
    CopilotMessagesContext: {
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    CopilotMessagesContextParams: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    CopilotTask: {
      docs: "https://docs.copilotkit.ai/generative-ui/tool-based",
    },
    CopilotTaskConfig: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/generative-ui/tool-based",
    },
    CrewsAgentState: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    CrewsResponse: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    CrewsResponseStatus: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    CrewsStateItem: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    CrewsTaskStateItem: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    CrewsToolStateItem: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    defaultCopilotContextCategories: {
      docs: "https://docs.copilotkit.ai/agent-app-context",
    },
    DocumentPointer: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/agent-app-context",
    },
    FrontendAction: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/generative-ui/tool-based",
    },
    FrontendActionAvailability: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/generative-ui/tool-based",
    },
    HintFunction: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    LangGraphInterruptAction: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/human-in-the-loop",
    },
    LangGraphInterruptActionSetter: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/human-in-the-loop",
    },
    LangGraphInterruptActionSetterArgs: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/human-in-the-loop",
    },
    LangGraphInterruptRender: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/human-in-the-loop",
    },
    LangGraphInterruptRenderHandlerProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/human-in-the-loop",
    },
    LangGraphInterruptRenderProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/human-in-the-loop",
    },
    OnReloadMessages: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    OnStopGeneration: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    QueuedInterruptEvent: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/human-in-the-loop",
    },
    RenderFunctionStatus: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/generative-ui/tool-rendering",
    },
    shouldShowDevConsole: {
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    SUGGESTION_RETRY_CONFIG: {
      docs: "https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions",
    },
    SystemMessageFunction: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    ThreadsContext: {
      docs: "https://docs.copilotkit.ai/prebuilt-components/copilot-threads-drawer",
    },
    ThreadsContextValue: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/copilot-threads-drawer",
    },
    ThreadsProvider: {
      docs: "https://docs.copilotkit.ai/prebuilt-components/copilot-threads-drawer",
    },
    ThreadsProviderProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/copilot-threads-drawer",
    },
    Tree: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/agent-app-context",
    },
    TreeNode: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/agent-app-context",
    },
    useCoAgent: {
      replacement: {
        name: "useAgent",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2/hooks/useAgent",
      },
    },
    useCoAgentStateRender: {
      replacement: {
        name: "useAgent",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/generative-ui/state-rendering",
        notes: [
          "Use useAgent to subscribe to agent state and run-status changes, then render agent.state directly.",
          "V2 uses ordinary React rendering instead of registering a chat-specific state renderer.",
        ],
      },
    },
    useCoAgentStateRenders: {
      docs: "https://docs.copilotkit.ai/generative-ui/state-rendering",
    },
    useCopilotAction: {
      replacement: {
        name: "useFrontendTool",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool",
      },
    },
    useCopilotAdditionalInstructions: {
      replacement: {
        name: "useAgentContext",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2/hooks/useAgentContext",
      },
    },
    useCopilotAuthenticatedAction_c: {
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    useCopilotChat: {
      replacement: {
        name: "useAgent",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2/hooks/useAgent",
      },
    },
    useCopilotChatHeadless_c: {
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    useCopilotChatInternal: {
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    UseCopilotChatOptions: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    UseCopilotChatOptions_c: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    UseCopilotChatReturn: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    UseCopilotChatReturn_c: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    useCopilotChatSuggestions: {
      replacement: {
        name: "useConfigureSuggestions",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions",
      },
    },
    UseCopilotChatSuggestionsConfiguration: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions",
    },
    useCopilotContext: {
      docs: "https://docs.copilotkit.ai/reference/v2/components/CopilotKit",
    },
    useCopilotMessagesContext: {
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    useCopilotReadable: {
      replacement: {
        name: "useAgentContext",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2/hooks/useAgentContext",
        notes: ["V2 models readable application state as agent context."],
      },
    },
    useCopilotRuntimeClient: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    useDefaultTool: {
      replacement: {
        name: "useDefaultRenderTool",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2/hooks/useDefaultRenderTool",
      },
    },
    useFrontendTool: {
      replacement: {
        name: "useFrontendTool",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool",
        notes: [
          "The v2 API uses a Zod schema instead of the v1 Parameter[] shape.",
        ],
      },
    },
    useHumanInTheLoop: {
      replacement: {
        name: "useHumanInTheLoop",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2/hooks/useHumanInTheLoop",
        notes: [
          "The v2 API uses a Zod schema instead of the v1 Parameter[] shape.",
        ],
      },
    },
    useLangGraphInterrupt: {
      replacement: {
        name: "useInterrupt",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2/hooks/useInterrupt",
        notes: ["Use the framework-neutral v2 interrupt API."],
      },
    },
    useLazyToolRenderer: {
      docs: "https://docs.copilotkit.ai/generative-ui/tool-rendering",
    },
    useMakeCopilotDocumentReadable: {
      docs: "https://docs.copilotkit.ai/agent-app-context",
    },
    useRenderToolCall: {
      replacement: {
        name: "useRenderTool",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2/hooks/useRenderTool",
        notes: [
          "Use useRenderTool to register a renderer for an existing backend tool in v2.",
          "The v2 hook named useRenderToolCall is a different, low-level consumer API.",
        ],
      },
    },
    useThreads: {
      replacement: {
        name: "useThreads",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2/hooks/useThreads",
      },
    },
  },
  "@copilotkit/react-ui": {
    AssistantMessage: {
      replacement: {
        name: "AssistantMessage",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2",
      },
    },
    AssistantMessageProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    Attachment: {
      typeOnly: true,
      replacement: {
        name: "Attachment",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2",
      },
    },
    AttachmentModality: {
      typeOnly: true,
      replacement: {
        name: "AttachmentModality",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2",
      },
    },
    AttachmentsConfig: {
      typeOnly: true,
      replacement: {
        name: "AttachmentsConfig",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2",
      },
    },
    ButtonProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    ChatError: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    ComponentsMap: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    CopilotChat: {
      replacement: {
        name: "CopilotChat",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2/components/CopilotChat",
        notes: [
          "V2 chat components and styles move from react-ui to react-core.",
          'Replace the stylesheet import with "@copilotkit/react-core/styles.css".',
        ],
      },
    },
    CopilotChatSuggestion: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions",
    },
    CopilotDevConsole: {
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    CopilotKitCSSProperties: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    CopilotModal: {
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    CopilotModalProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    CopilotObservabilityHooks: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    CopilotPopup: {
      replacement: {
        name: "CopilotPopup",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2/components/CopilotPopup",
      },
    },
    CopilotSidebar: {
      replacement: {
        name: "CopilotSidebar",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2/components/CopilotSidebar",
      },
    },
    CopilotSidebarProps: {
      typeOnly: true,
      replacement: {
        name: "CopilotSidebarProps",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2",
      },
    },
    ErrorMessageProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    HeaderProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    ImageRenderer: {
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    ImageRendererProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    InputProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    Markdown: {
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    MessagesProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    Renderer: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    RenderMessageProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    RenderSuggestion: {
      docs: "https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions",
    },
    RenderSuggestionsList: {
      docs: "https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions",
    },
    RenderSuggestionsListProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions",
    },
    shouldShowDevConsole: {
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    SuggestionsProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions",
    },
    suppressDeprecationWarnings: {
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    useChatContext: {
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    useCopilotChatSuggestions: {
      replacement: {
        name: "useConfigureSuggestions",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions",
        notes: ["This replacement moves from react-ui to react-core."],
      },
    },
    UserMessage: {
      replacement: {
        name: "UserMessage",
        importPath: "@copilotkit/react-core",
        docs: "https://docs.copilotkit.ai/reference/v2",
      },
    },
    UserMessageProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
    WindowProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/prebuilt-components/chat",
    },
  },
  "@copilotkit/react-textarea": {
    AutosuggestionsBareFunction: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    AutosuggestionsConfig: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    AutosuggestionsConfigUserSpecified: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    BaseAutosuggestionsConfig: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    BaseCopilotTextarea: {
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    BaseCopilotTextareaProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    CopilotTextarea: {
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    CopilotTextareaProps: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    defaultAutosuggestionsConfig: {
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    defaultBaseAutosuggestionsConfig: {
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    HTMLCopilotTextAreaElement: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    InsertionsApiConfigUserSpecified: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    MakeSystemPrompt: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    SuggestionsApiConfigUserSpecified: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
  },
  "@copilotkit/runtime": {
    AgentFactoryContext: {
      typeOnly: true,
      replacement: {
        name: "AgentFactoryContext",
        importPath: "@copilotkit/runtime",
        docs: "https://docs.copilotkit.ai/runtime-server-adapter",
      },
    },
    AgentsConfig: {
      typeOnly: true,
      replacement: {
        name: "AgentsConfig",
        importPath: "@copilotkit/runtime",
        docs: "https://docs.copilotkit.ai/runtime-server-adapter",
      },
    },
    AgentsFactory: {
      typeOnly: true,
      replacement: {
        name: "AgentsFactory",
        importPath: "@copilotkit/runtime",
        docs: "https://docs.copilotkit.ai/runtime-server-adapter",
      },
    },
    AnthropicAdapter: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    AnthropicAdapterParams: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    AnthropicPromptCachingConfig: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    BedrockAdapter: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    BedrockAdapterParams: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    buildSchema: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    CommonConfig: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    config: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    convertMCPToolsToActions: {
      docs: "https://docs.copilotkit.ai/agentic-protocols/mcp",
    },
    convertServiceAdapterError: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    CopilotEndpointCorsConfig: {
      typeOnly: true,
      replacement: {
        name: "CopilotEndpointCorsConfig",
        importPath: "@copilotkit/runtime",
        docs: "https://docs.copilotkit.ai/runtime-server-adapter",
      },
    },
    copilotKitEndpoint: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    CopilotRequestContextProperties: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    CopilotRuntime: {
      replacement: {
        name: "CopilotRuntime",
        importPath: "@copilotkit/runtime",
        docs: "https://docs.copilotkit.ai/runtime-server-adapter",
        notes: [
          "V2 uses AG-UI runtime handlers instead of the v1 GraphQL adapter setup.",
        ],
      },
    },
    CopilotRuntimeChatCompletionRequest: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    CopilotRuntimeChatCompletionResponse: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    CopilotRuntimeConstructorParams_BASE: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    CopilotRuntimeLogger: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    copilotRuntimeNestEndpoint: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    copilotRuntimeNextJSAppRouterEndpoint: {
      replacement: {
        name: "createCopilotRuntimeHandler",
        importPath: "@copilotkit/runtime",
        docs: "https://docs.copilotkit.ai/runtime-server-adapter",
      },
    },
    copilotRuntimeNextJSPagesRouterEndpoint: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    copilotRuntimeNodeExpressEndpoint: {
      replacement: {
        name: "createCopilotExpressHandler",
        importPath: "@copilotkit/runtime/express",
        docs: "https://docs.copilotkit.ai/runtime-server-adapter",
      },
    },
    copilotRuntimeNodeHttpEndpoint: {
      replacement: {
        name: "createCopilotRuntimeHandler",
        importPath: "@copilotkit/runtime",
        docs: "https://docs.copilotkit.ai/runtime-server-adapter",
      },
    },
    CopilotServiceAdapter: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    CreateCopilotRuntimeServerOptions: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    createLogger: {
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    CustomEventNames: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/agent-spec/langgraph",
    },
    EmptyAdapter: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    ExperimentalEmptyAdapter: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    ExperimentalOllamaAdapter: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    extractParametersFromSchema: {
      docs: "https://docs.copilotkit.ai/agentic-protocols/mcp",
    },
    FilterThinkingTextBuffer: {
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    generateMcpToolInstructions: {
      docs: "https://docs.copilotkit.ai/agentic-protocols/mcp",
    },
    getCommonConfig: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    getSdkClientOptions: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    GoogleGenerativeAIAdapter: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    GraphQLContext: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    GraphQLRequestContext: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    GroqAdapter: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    GroqAdapterParams: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    GuardrailsValidationFailureResponse: {
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    LangChainAdapter: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    LangGraphAgent: {
      docs: "https://docs.copilotkit.ai/agent-spec/langgraph",
    },
    LangGraphHttpAgent: {
      docs: "https://docs.copilotkit.ai/agent-spec/langgraph",
      notes: [
        "Use `HttpAgent` from `@ag-ui/client`, passed to the v2 `CopilotRuntime`.",
        "Exception: a v1 client still resuming interrupts through `forwardedProps.command.resume` — `LangGraphHttpAgent` keeps a back-compat bridge for that channel.",
      ],
    },
    langGraphPlatformEndpoint: {
      docs: "https://docs.copilotkit.ai/agent-spec/langgraph",
    },
    LogLevel: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    MCPClient: {
      typeOnly: true,
      replacement: {
        name: "MCPClient",
        importPath: "@copilotkit/runtime",
        docs: "https://docs.copilotkit.ai/runtime-server-adapter",
      },
    },
    MCPEndpointConfig: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/agentic-protocols/mcp",
    },
    MCPTool: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/agentic-protocols/mcp",
    },
    MessageStreamInterruptedResponse: {
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    OpenAIAdapter: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    OpenAIAdapterParams: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    OpenAIAssistantAdapter: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    OpenAIAssistantAdapterParams: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    PredictStateTool: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/agent-spec/langgraph",
    },
    RemoteChain: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    RemoteChainParameters: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    resolveEndpointType: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    SdkClientLike: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    TelemetryAgentRunner: {
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    TelemetryAgentRunnerConfig: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
    TextMessageEvents: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/agent-spec/langgraph",
    },
    ToolCallEvents: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/agent-spec/langgraph",
    },
    UnifyAdapter: {
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    UnifyAdapterParams: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    },
    UnknownErrorResponse: {
      docs: "https://docs.copilotkit.ai/reference/v2",
    },
  },
  "@copilotkit/runtime/langgraph": {
    CustomEventNames: {
      docs: "https://docs.copilotkit.ai/agent-spec/langgraph",
    },
    LangGraphAgent: {
      docs: "https://docs.copilotkit.ai/agent-spec/langgraph",
    },
    LangGraphHttpAgent: {
      docs: "https://docs.copilotkit.ai/agent-spec/langgraph",
      notes: [
        "Use `HttpAgent` from `@ag-ui/client`, passed to the v2 `CopilotRuntime`.",
        "Exception: a v1 client still resuming interrupts through `forwardedProps.command.resume` — `LangGraphHttpAgent` keeps a back-compat bridge for that channel.",
      ],
    },
    PredictStateTool: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/agent-spec/langgraph",
    },
    TextMessageEvents: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/agent-spec/langgraph",
    },
    ToolCallEvents: {
      typeOnly: true,
      docs: "https://docs.copilotkit.ai/agent-spec/langgraph",
    },
  },
};
