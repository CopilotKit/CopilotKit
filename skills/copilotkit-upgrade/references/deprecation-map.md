# CopilotKit v1 Deprecation Map

Complete mapping of every deprecated v1 API to its v2 replacement.

## Hooks

| v1 Hook                            | v1 Package               | v2 Replacement                                                | v2 Package                          | Status                                                                        |
| ---------------------------------- | ------------------------ | ------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| `useCopilotAction`                 | `@copilotkit/react-core` | `useFrontendTool`                                             | `@copilotkit/react-core/v2`         | Renamed + new parameter format (Zod)                                          |
| `useCopilotReadable`               | `@copilotkit/react-core` | `useAgentContext`                                             | `@copilotkit/react-core/v2`         | Renamed, `parentId` removed                                                   |
| `useCopilotChat`                   | `@copilotkit/react-core` | `useAgent`                                                    | `@copilotkit/react-core/v2`         | Replaced (different API)                                                      |
| `useCoAgent`                       | `@copilotkit/react-core` | `useAgent`                                                    | `@copilotkit/react-core/v2`         | Renamed, different return type                                                |
| `useCoAgentStateRender`            | `@copilotkit/react-core` | `useRenderTool` / `useRenderActivityMessage`                  | `@copilotkit/react-core/v2`         | Split: render-by-name + activity rendering                                    |
| `useLangGraphInterrupt`            | `@copilotkit/react-core` | `useInterrupt`                                                | `@copilotkit/react-core/v2`         | Renamed + new API                                                             |
| `useCopilotChatSuggestions`        | `@copilotkit/react-core` | `useConfigureSuggestions` + `useSuggestions`                  | `@copilotkit/react-core/v2`         | Split into two hooks                                                          |
| `useCopilotAdditionalInstructions` | `@copilotkit/react-core` | `useAgentContext`                                             | `@copilotkit/react-core/v2`         | Use description/value context                                                 |
| `useMakeCopilotDocumentReadable`   | `@copilotkit/react-core` | `useAgentContext`                                             | `@copilotkit/react-core/v2`         | Pass content directly                                                         |
| `useCopilotRuntimeClient`          | `@copilotkit/react-core` | `useCopilotKit`                                               | `@copilotkit/react-core/v2/context` | Access core via provider context                                              |
| `useCopilotContext`                | `@copilotkit/react-core` | `useCopilotKit`                                               | `@copilotkit/react-core/v2/context` | Returns `{ copilotkit, executingToolCallIds }`                                |
| `useCopilotMessagesContext`        | `@copilotkit/react-core` | --                                                            | --                                  | Removed (use agent event stream)                                              |
| `useCoAgentStateRenders`           | `@copilotkit/react-core` | --                                                            | --                                  | Removed (context no longer needed)                                            |
| `useCopilotChatInternal`           | `@copilotkit/react-core` | --                                                            | --                                  | Internal, removed                                                             |
| `useCopilotChatHeadless_c`         | `@copilotkit/react-core` | --                                                            | --                                  | Internal, removed                                                             |
| `useCopilotAuthenticatedAction_c`  | `@copilotkit/react-core` | --                                                            | --                                  | Internal, removed                                                             |
| `useFrontendTool`                  | `@copilotkit/react-core` | `useFrontendTool`                                             | `@copilotkit/react-core/v2`         | Same name, import path changes                                                |
| `useHumanInTheLoop`                | `@copilotkit/react-core` | `useHumanInTheLoop`                                           | `@copilotkit/react-core/v2`         | Same name, import path changes                                                |
| `useRenderToolCall`                | `@copilotkit/react-core` | `useRenderToolCall`                                           | `@copilotkit/react-core/v2`         | Same name, import path changes                                                |
| `useDefaultTool`                   | `@copilotkit/react-core` | `useDefaultRenderTool` (render) / `useFrontendTool` (handler) | `@copilotkit/react-core/v2`         | Split: v1's catch-all had a handler; v2 `useDefaultRenderTool` is render-only |
| `useLazyToolRenderer`              | `@copilotkit/react-core` | --                                                            | --                                  | Removed                                                                       |
| `useChatContext` (react-ui)        | `@copilotkit/react-ui`   | `useCopilotChatConfiguration`                                 | `@copilotkit/react-core/v2`         | Renamed                                                                       |

## Components

| v1 Component                  | v1 Package                   | v2 Replacement                | v2 Package                  | Status                                                                        |
| ----------------------------- | ---------------------------- | ----------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| `CopilotKit`                  | `@copilotkit/react-core`     | `CopilotKit`                  | `@copilotkit/react-core/v2` | Same name, new import path                                                    |
| `CopilotChat`                 | `@copilotkit/react-ui`       | `CopilotChat`                 | `@copilotkit/react-core/v2` | Same name, new package                                                        |
| `CopilotPopup`                | `@copilotkit/react-ui`       | `CopilotPopup`                | `@copilotkit/react-core/v2` | Same name, new package                                                        |
| `CopilotSidebar`              | `@copilotkit/react-ui`       | `CopilotSidebar`              | `@copilotkit/react-core/v2` | Same name, new package                                                        |
| `CopilotTextarea`             | `@copilotkit/react-textarea` | --                            | --                          | **Removed**                                                                   |
| `CopilotDevConsole`           | `@copilotkit/react-ui`       | `CopilotKitInspector`         | `@copilotkit/react-core/v2` | Renamed                                                                       |
| `Markdown`                    | `@copilotkit/react-ui`       | --                            | --                          | Removed -- v2 chat components render markdown internally                      |
| `AssistantMessage`            | `@copilotkit/react-ui`       | `CopilotChatAssistantMessage` | `@copilotkit/react-core/v2` | Renamed                                                                       |
| `UserMessage`                 | `@copilotkit/react-ui`       | `CopilotChatUserMessage`      | `@copilotkit/react-core/v2` | Renamed                                                                       |
| `ImageRenderer`               | `@copilotkit/react-ui`       | --                            | --                          | Removed                                                                       |
| `RenderSuggestionsList`       | `@copilotkit/react-ui`       | `CopilotChatSuggestionView`   | `@copilotkit/react-core/v2` | Renamed                                                                       |
| `RenderSuggestion`            | `@copilotkit/react-ui`       | `CopilotChatSuggestionPill`   | `@copilotkit/react-core/v2` | Renamed                                                                       |
| `CoAgentStateRendersProvider` | `@copilotkit/react-core`     | --                            | --                          | Removed (no v2 equivalent)                                                    |
| `ThreadsProvider`             | `@copilotkit/react-core`     | `useThreads`                  | `@copilotkit/react-core/v2` | Provider removed; use the `useThreads` hook for client-side thread management |

> **Note:** `@copilotkit/react-core/v2` also exports a `CopilotKitProvider` component. Do not migrate to it -- it is a functionality subset of `CopilotKit` (from `/v2`), which is the compatibility bridge across v1 and v2.

## Runtime Classes

| v1 Class/Function              | v1 Package            | v2 Replacement                                | v2 Package                      | Status                                                                               |
| ------------------------------ | --------------------- | --------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| `CopilotRuntime`               | `@copilotkit/runtime` | `CopilotRuntime`                              | `@copilotkit/runtime/v2`        | Same name, different constructor API                                                 |
| `OpenAIAdapter`                | `@copilotkit/runtime` | `BuiltInAgent({ model: "openai/..." })`       | `@copilotkit/runtime/v2`        | **Removed**                                                                          |
| `AnthropicAdapter`             | `@copilotkit/runtime` | `BuiltInAgent({ model: "anthropic/..." })`    | `@copilotkit/runtime/v2`        | **Removed**                                                                          |
| `GoogleGenerativeAIAdapter`    | `@copilotkit/runtime` | `BuiltInAgent({ model: "google/..." })`       | `@copilotkit/runtime/v2`        | **Removed**                                                                          |
| `LangChainAdapter`             | `@copilotkit/runtime` | Custom `AbstractAgent`                        | --                              | **Removed**                                                                          |
| `GroqAdapter`                  | `@copilotkit/runtime` | Custom `AbstractAgent` (Groq `LanguageModel`) | --                              | **Removed**                                                                          |
| `UnifyAdapter`                 | `@copilotkit/runtime` | Custom `AbstractAgent`                        | --                              | **Removed**                                                                          |
| `OpenAIAssistantAdapter`       | `@copilotkit/runtime` | Custom `AbstractAgent`                        | --                              | **Removed**                                                                          |
| `BedrockAdapter`               | `@copilotkit/runtime` | Custom `AbstractAgent`                        | --                              | **Removed**                                                                          |
| `OllamaAdapter` (experimental) | `@copilotkit/runtime` | Custom `AbstractAgent`                        | --                              | **Removed**                                                                          |
| `EmptyAdapter`                 | `@copilotkit/runtime` | --                                            | --                              | **Removed**                                                                          |
| `RemoteChain`                  | `@copilotkit/runtime` | --                                            | --                              | **Removed**                                                                          |
| `LangGraphAgent`               | `@copilotkit/runtime` | `LangGraphAgent`                              | `@copilotkit/runtime/langgraph` | Moved to the `/langgraph` subpath                                                    |
| `LangGraphHttpAgent`           | `@copilotkit/runtime` | `LangGraphHttpAgent`                          | `@copilotkit/runtime/langgraph` | Distinct class (not merged into `LangGraphAgent`); moved to the `/langgraph` subpath |

## Runtime Framework Integrations

| v1 Function                               | v1 Package            | v2 Replacement                | v2 Package                       | Status                                                                |
| ----------------------------------------- | --------------------- | ----------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| `copilotRuntimeNextJSAppRouterEndpoint`   | `@copilotkit/runtime` | `createCopilotHonoHandler`    | `@copilotkit/runtime/v2`         | **Removed** (use Hono; `createCopilotEndpoint` is a deprecated alias) |
| `copilotRuntimeNextJSPagesRouterEndpoint` | `@copilotkit/runtime` | `createCopilotHonoHandler`    | `@copilotkit/runtime/v2`         | **Removed** (use Hono; `createCopilotEndpoint` is a deprecated alias) |
| `CopilotRuntimeNodeExpressEndpoint`       | `@copilotkit/runtime` | `createCopilotExpressHandler` | `@copilotkit/runtime/v2/express` | Renamed                                                               |
| `CopilotRuntimeNestEndpoint`              | `@copilotkit/runtime` | `createCopilotHonoHandler`    | `@copilotkit/runtime/v2`         | **Removed** (use Hono)                                                |
| `CopilotRuntimeNodeHttpEndpoint`          | `@copilotkit/runtime` | `createCopilotHonoHandler`    | `@copilotkit/runtime/v2`         | **Removed** (use Hono)                                                |

## Types

| v1 Type                              | v1 Package               | v2 Replacement                   | v2 Package                   | Status                                                                           |
| ------------------------------------ | ------------------------ | -------------------------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| `CopilotKitProps`                    | `@copilotkit/react-core` | `CopilotKitProps`                | `@copilotkit/react-core/v2`  | Same name, new import path (extends `Omit<CopilotKitProviderProps, "children">`) |
| `CopilotContextParams`               | `@copilotkit/react-core` | `CopilotKitContextValue`         | `@copilotkit/react-core/v2`  | Renamed                                                                          |
| `FrontendAction`                     | `@copilotkit/react-core` | `ReactFrontendTool`              | `@copilotkit/react-core/v2`  | Renamed + restructured                                                           |
| `ActionRenderProps`                  | `@copilotkit/react-core` | `ReactToolCallRenderer`          | `@copilotkit/react-core/v2`  | Renamed + restructured                                                           |
| `DocumentPointer`                    | `@copilotkit/react-core` | --                               | --                           | **Removed**                                                                      |
| `SystemMessageFunction`              | `@copilotkit/react-core` | --                               | --                           | **Removed**                                                                      |
| `CopilotChatSuggestionConfiguration` | `@copilotkit/react-core` | `Suggestion`                     | `@copilotkit/core`           | Renamed                                                                          |
| `Parameter`                          | `@copilotkit/shared`     | Zod schemas / `StandardSchemaV1` | `zod` / `@copilotkit/shared` | Replaced with schema-based                                                       |
| `CopilotServiceAdapter`              | `@copilotkit/runtime`    | `AbstractAgent`                  | `@ag-ui/client`              | Replaced                                                                         |
| `TextMessageEvents`                  | `@copilotkit/runtime`    | --                               | --                           | **Removed** (@deprecated)                                                        |
| `ToolCallEvents`                     | `@copilotkit/runtime`    | --                               | --                           | **Removed** (@deprecated)                                                        |
| `CustomEventNames`                   | `@copilotkit/runtime`    | --                               | --                           | **Removed** (@deprecated)                                                        |
| `PredictStateTool`                   | `@copilotkit/runtime`    | --                               | --                           | **Removed** (@deprecated)                                                        |

## v1 Props Marked @deprecated Within v1

These were already deprecated within v1 itself:

| Location               | Deprecated API                                               | Replacement                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FrontendAction`       | `disabled`                                                   | `available: false` (boolean; defaults to `true`)                                                                                                              |
| `ActionRenderProps`    | `respond()`                                                  | Use `respond` (same, just documented differently)                                                                                                             |
| `CopilotKitProps`      | `guardrails_c`                                               | `@internal`/defunct in source but still populates the legacy CopilotCloud `restrictToTopic` config when a cloud key is set; no effect on the v2 AG-UI runtime |
| `CopilotRuntime`       | `onBeforeRequest` / `onAfterRequest`                         | `beforeRequestMiddleware` / `afterRequestMiddleware`                                                                                                          |
| `useCopilotChat`       | `visibleMessages`                                            | Use AG-UI message stream                                                                                                                                      |
| `useCopilotChat`       | `appendMessage`                                              | Use `sendMessage` or agent API                                                                                                                                |
| Chat component props   | `AssistantMessage` / `UserMessage` / `Messages` render props | `RenderMessage`                                                                                                                                               |
| `useA2UIStore`         | `useA2UIStore`                                               | `useA2UIContext`                                                                                                                                              |
| `useA2UIStoreSelector` | `useA2UIStoreSelector`                                       | `useA2UIContext`                                                                                                                                              |
