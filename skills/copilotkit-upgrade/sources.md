# Sources

Files and directories read from CopilotKit/CopilotKit to generate this skill's references.
Generated: 2026-06-18 (regenerated against live `main`)

> **Package layout note:** the repo is a flat monorepo -- every package lives directly
> under `packages/<name>` (there is no `packages/v1/` or `packages/v2/` directory).
> v2 ships from the **`/v2` subpath of the same packages**: v2 React is
> `@copilotkit/react-core/v2` (source: `packages/react-core/src/v2/`) and v2 runtime is
> `@copilotkit/runtime/v2` (source: `packages/runtime/src/v2/`). There is no
> `@copilotkit/react` or `@copilotkit/agent` package -- `BuiltInAgent` and the v2 agent
> definitions are re-exported from `@copilotkit/runtime/v2`
> (source: `packages/runtime/src/agent/`).

## v1-to-v2-migration.md

- packages/react-core/src/index.tsx (v1 hook exports: useCopilotAction, useCopilotReadable, useCoAgent, useLangGraphInterrupt, useCopilotChat, useCopilotChatSuggestions, useCopilotAdditionalInstructions, useMakeCopilotDocumentReadable, CopilotKit provider)
- packages/react-ui/src/components/chat/index.tsx (v1 component exports: CopilotChat, CopilotPopup, CopilotSidebar; CSS-only in v2)
- packages/react-textarea/src/index.tsx (CopilotTextarea export, confirmed removed in v2)
- packages/runtime/src/index.ts (v1 runtime exports: CopilotRuntime, OpenAIAdapter, AnthropicAdapter, GoogleGenerativeAIAdapter, LangChainAdapter, copilotRuntimeNextJSAppRouterEndpoint, copilotKitEndpoint)
- packages/runtime-client-gql/src/index.ts (v1 GraphQL types: TextMessage, MessageRole, ActionExecutionMessage, ResultMessage)
- packages/react-core/src/v2/index.ts (v2 React exports under `@copilotkit/react-core/v2`: useFrontendTool, useAgentContext, useAgent, useInterrupt, useSuggestions, useConfigureSuggestions, useRenderToolCall, useRenderActivityMessage, useHumanInTheLoop, CopilotKit compat provider -- the recommended migration target; CopilotKitProvider is also exported but is a functionality subset; chat components CopilotChat/CopilotPopup/CopilotSidebar; re-exports `@copilotkit/core` and `@ag-ui/client`)
- packages/runtime/src/v2/index.ts (v2 runtime exports under `@copilotkit/runtime/v2`: CopilotRuntime, createCopilotHonoHandler [deprecated alias createCopilotEndpoint], CopilotKitIntelligence, InMemoryAgentRunner)
- packages/runtime/src/v2/runtime/endpoints/express.ts (Express endpoint helper `createCopilotExpressHandler`, exported from `@copilotkit/runtime/v2/express`)
- packages/runtime/src/agent/index.ts (v2 agent exports re-exported from `@copilotkit/runtime/v2`: BuiltInAgent, defineTool)
- packages/core/src/ (CopilotKitCore, AG-UI event types, AbstractAgent interface; re-exported by `@copilotkit/react-core/v2`)

## breaking-changes.md

- packages/react-core/src/ (v1 provider props: CopilotKitProps, parameter descriptor format, FrontendAction type, ActionRenderProps)
- packages/runtime/src/ (v1 service adapters, CopilotRuntime constructor with actions/remoteEndpoints, framework integration functions)
- packages/shared/src/ (v1 Parameter type definition)
- packages/react-core/src/v2/ (v2 provider props: CopilotKitProviderProps, Zod parameter schemas, useFrontendTool available prop)
- packages/runtime/src/v2/ (v2 CopilotRuntime constructor with agents/middleware, createCopilotHonoHandler Hono-based)
- packages/core/src/ (AG-UI event types, message types replacing GraphQL types)
- packages/runtime/src/agent/ (BuiltInAgent replacing all service adapters)

## deprecation-map.md

- packages/react-core/src/index.tsx (all v1 hook and component exports)
- packages/react-ui/src/components/chat/index.tsx (all v1 UI component exports)
- packages/react-textarea/src/index.tsx (CopilotTextarea export)
- packages/runtime/src/index.ts (all v1 runtime class and function exports)
- packages/runtime-client-gql/src/index.ts (v1 GraphQL client exports)
- packages/shared/src/index.ts (v1 shared type exports)
- packages/sdk-js/src/index.ts (v1 SDK exports)
- packages/react-core/src/v2/index.ts (all v2 React hook and component exports)
- packages/runtime/src/v2/index.ts (all v2 runtime exports)
- packages/runtime/src/agent/index.ts (v2 agent exports)
- packages/core/src/index.ts (v2 core exports)
- packages/shared/src/index.ts (v2 shared type exports)
