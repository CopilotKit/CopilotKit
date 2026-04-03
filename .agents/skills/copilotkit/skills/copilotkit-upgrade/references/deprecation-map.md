# CopilotKit v1 Deprecation Map

Complete mapping of every deprecated v1 API to its v2 replacement.

## Hooks

| v1 Hook | v1 Package | v2 Replacement | v2 Package | Status |
|---------|-----------|---------------|-----------|--------|
| `useCopilotAction` | `@copilotkit/react-core` | `useFrontendTool` | `@copilotkit/react` | Renamed + new parameter format (Zod) |
| `useCopilotReadable` | `@copilotkit/react-core` | `useAgentContext` | `@copilotkit/react` | Renamed, `parentId` removed |
| `useCopilotChat` | `@copilotkit/react-core` | `useAgent` | `@copilotkit/react` | Replaced (different API) |
| `useCoAgent` | `@copilotkit/react-core` | `useAgent` | `@copilotkit/react` | Renamed, different return type |
| `useCoAgentStateRender` | `@copilotkit/react-core` | `useRenderToolCall` / `useRenderActivityMessage` | `@copilotkit/react` | Split into two hooks |
| `useLangGraphInterrupt` | `@copilotkit/react-core` | `useInterrupt` | `@copilotkit/react` | Renamed + new API |
| `useCopilotChatSuggestions` | `@copilotkit/react-core` | `useConfigureSuggestions` + `useSuggestions` | `@copilotkit/react` | Split into two hooks |
| `useCopilotAdditionalInstructions` | `@copilotkit/react-core` | `useAgentContext` | `@copilotkit/react` | Use description/value context |
| `useMakeCopilotDocumentReadable` | `@copilotkit/react-core` | `useAgentContext` | `@copilotkit/react` | Pass content directly |
| `useCopilotRuntimeClient` | `@copilotkit/react-core` | `useCopilotKit` | `@copilotkit/react` | Access core via provider context |
| `useCopilotContext` | `@copilotkit/react-core` | `useCopilotKit` | `@copilotkit/react` | Returns `{ copilotkit }` |
| `useCopilotMessagesContext` | `@copilotkit/react-core` | -- | -- | Removed (use agent event stream) |
| `useCoAgentStateRenders` | `@copilotkit/react-core` | -- | -- | Removed (context no longer needed) |
| `useCopilotChatInternal` | `@copilotkit/react-core` | -- | -- | Internal, removed |
| `useCopilotChatHeadless_c` | `@copilotkit/react-core` | -- | -- | Internal, removed |
| `useCopilotAuthenticatedAction_c` | `@copilotkit/react-core` | -- | -- | Internal, removed |
| `useFrontendTool` | `@copilotkit/react-core` | `useFrontendTool` | `@copilotkit/react` | Same name, import path changes |
| `useHumanInTheLoop` | `@copilotkit/react-core` | `useHumanInTheLoop` | `@copilotkit/react` | Same name, import path changes |
| `useRenderToolCall` | `@copilotkit/react-core` | `useRenderToolCall` | `@copilotkit/react` | Same name, import path changes |
| `useDefaultTool` | `@copilotkit/react-core` | `useDefaultRenderTool` | `@copilotkit/react` | Renamed |
| `useLazyToolRenderer` | `@copilotkit/react-core` | -- | -- | Removed |
| `useChatContext` (react-ui) | `@copilotkit/react-ui` | `useCopilotChatConfiguration` | `@copilotkit/react` | Renamed |

## Components

| v1 Component | v1 Package | v2 Replacement | v2 Package | Status |
|-------------|-----------|---------------|-----------|--------|
| `CopilotKit` | `@copilotkit/react-core` | `CopilotKitProvider` | `@copilotkit/react` | Renamed |
| `CopilotChat` | `@copilotkit/react-ui` | `CopilotChat` | `@copilotkit/react` | Same name, new package |
| `CopilotPopup` | `@copilotkit/react-ui` | `CopilotPopup` | `@copilotkit/react` | Same name, new package |
| `CopilotSidebar` | `@copilotkit/react-ui` | `CopilotSidebar` | `@copilotkit/react` | Same name, new package |
| `CopilotTextarea` | `@copilotkit/react-textarea` | -- | -- | **Removed** |
| `CopilotDevConsole` | `@copilotkit/react-ui` | `CopilotKitInspector` | `@copilotkit/react` | Renamed |
| `Markdown` | `@copilotkit/react-ui` | -- | -- | Removed (use A2UI renderer) |
| `AssistantMessage` | `@copilotkit/react-ui` | `CopilotChatAssistantMessage` | `@copilotkit/react` | Renamed |
| `UserMessage` | `@copilotkit/react-ui` | `CopilotChatUserMessage` | `@copilotkit/react` | Renamed |
| `ImageRenderer` | `@copilotkit/react-ui` | -- | -- | Removed |
| `RenderSuggestionsList` | `@copilotkit/react-ui` | `CopilotChatSuggestionView` | `@copilotkit/react` | Renamed |
| `RenderSuggestion` | `@copilotkit/react-ui` | `CopilotChatSuggestionPill` | `@copilotkit/react` | Renamed |
| `CoAgentStateRendersProvider` | `@copilotkit/react-core` | -- | -- | Removed (no v2 equivalent) |
| `ThreadsProvider` | `@copilotkit/react-core` | -- | -- | Removed (threads managed by runtime) |

## Runtime Classes

| v1 Class/Function | v1 Package | v2 Replacement | v2 Package | Status |
|------------------|-----------|---------------|-----------|--------|
| `CopilotRuntime` | `@copilotkit/runtime` | `CopilotRuntime` | `@copilotkit/runtime` | Same name, different constructor API |
| `OpenAIAdapter` | `@copilotkit/runtime` | `BuiltInAgent({ model: "openai:..." })` | `@copilotkit/agent` | **Removed** |
| `AnthropicAdapter` | `@copilotkit/runtime` | `BuiltInAgent({ model: "anthropic:..." })` | `@copilotkit/agent` | **Removed** |
| `GoogleGenerativeAIAdapter` | `@copilotkit/runtime` | `BuiltInAgent({ model: "google:..." })` | `@copilotkit/agent` | **Removed** |
| `LangChainAdapter` | `@copilotkit/runtime` | Custom `AbstractAgent` | -- | **Removed** |
| `GroqAdapter` | `@copilotkit/runtime` | `BuiltInAgent` with Groq model | `@copilotkit/agent` | **Removed** |
| `UnifyAdapter` | `@copilotkit/runtime` | Custom `AbstractAgent` | -- | **Removed** |
| `OpenAIAssistantAdapter` | `@copilotkit/runtime` | Custom `AbstractAgent` | -- | **Removed** |
| `BedrockAdapter` | `@copilotkit/runtime` | `BuiltInAgent({ model: "vertex:..." })` | `@copilotkit/agent` | **Removed** |
| `OllamaAdapter` (experimental) | `@copilotkit/runtime` | Custom `AbstractAgent` | -- | **Removed** |
| `EmptyAdapter` | `@copilotkit/runtime` | -- | -- | **Removed** |
| `RemoteChain` | `@copilotkit/runtime` | -- | -- | **Removed** |
| `LangGraphAgent` | `@copilotkit/runtime` | `LangGraphAgent` | `@ag-ui/langgraph` | Moved to AG-UI package |
| `LangGraphHttpAgent` | `@copilotkit/runtime` | `LangGraphAgent` | `@ag-ui/langgraph` | Moved + renamed |

## Runtime Framework Integrations

| v1 Function | v1 Package | v2 Replacement | v2 Package | Status |
|------------|-----------|---------------|-----------|--------|
| `copilotRuntimeNextJSAppRouterEndpoint` | `@copilotkit/runtime` | `createCopilotEndpoint` | `@copilotkit/runtime` | **Removed** (use Hono) |
| `copilotRuntimeNextJSPagesRouterEndpoint` | `@copilotkit/runtime` | `createCopilotEndpoint` | `@copilotkit/runtime` | **Removed** (use Hono) |
| `CopilotRuntimeNodeExpressEndpoint` | `@copilotkit/runtime` | `createCopilotEndpointExpress` | `@copilotkit/runtime` | Renamed |
| `CopilotRuntimeNestEndpoint` | `@copilotkit/runtime` | `createCopilotEndpoint` | `@copilotkit/runtime` | **Removed** (use Hono) |
| `CopilotRuntimeNodeHttpEndpoint` | `@copilotkit/runtime` | `createCopilotEndpoint` | `@copilotkit/runtime` | **Removed** (use Hono) |

## Types

| v1 Type | v1 Package | v2 Replacement | v2 Package | Status |
|---------|-----------|---------------|-----------|--------|
| `CopilotKitProps` | `@copilotkit/react-core` | `CopilotKitProviderProps` | `@copilotkit/react` | Renamed |
| `CopilotContextParams` | `@copilotkit/react-core` | `CopilotKitContextValue` | `@copilotkit/react` | Renamed |
| `FrontendAction` | `@copilotkit/react-core` | `ReactFrontendTool` | `@copilotkit/react` | Renamed + restructured |
| `ActionRenderProps` | `@copilotkit/react-core` | `ReactToolCallRenderer` | `@copilotkit/react` | Renamed + restructured |
| `DocumentPointer` | `@copilotkit/react-core` | -- | -- | **Removed** |
| `SystemMessageFunction` | `@copilotkit/react-core` | -- | -- | **Removed** |
| `CopilotChatSuggestionConfiguration` | `@copilotkit/react-core` | `Suggestion` | `@copilotkit/core` | Renamed |
| `Parameter` | `@copilotkit/shared` | Zod schemas / `StandardSchemaV1` | `zod` / `@copilotkit/shared` | Replaced with schema-based |
| `CopilotServiceAdapter` | `@copilotkit/runtime` | `AbstractAgent` | `@ag-ui/client` | Replaced |
| `TextMessageEvents` | `@copilotkit/runtime` | -- | -- | **Removed** (@deprecated) |
| `ToolCallEvents` | `@copilotkit/runtime` | -- | -- | **Removed** (@deprecated) |
| `CustomEventNames` | `@copilotkit/runtime` | -- | -- | **Removed** (@deprecated) |
| `PredictStateTool` | `@copilotkit/runtime` | -- | -- | **Removed** (@deprecated) |

## v1 Props Marked @deprecated Within v1

These were already deprecated within v1 itself:

| Location | Deprecated API | Replacement |
|----------|---------------|-------------|
| `FrontendAction` | `disabled` | `available: "disabled"` |
| `ActionRenderProps` | `respond()` | Use `respond` (same, just documented differently) |
| `CopilotKitProps` | `guardrails_c` | Removed in v2 |
| `CopilotRuntime` | `onBeforeRequest` / `onAfterRequest` | `beforeRequestMiddleware` / `afterRequestMiddleware` |
| `useCopilotChat` | `visibleMessages` | Use AG-UI message stream |
| `useCopilotChat` | `appendMessage` | Use `sendMessage` or agent API |
| Chat component props | `AssistantMessage` / `UserMessage` / `Messages` render props | `RenderMessage` |
| `useA2UIStore` | `useA2UIStore` | `useA2UIContext` |
| `useA2UIStoreSelector` | `useA2UIStoreSelector` | `useA2UIContext` |
