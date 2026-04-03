# Sources

Files and directories read from CopilotKit/CopilotKit to generate this skill's references.
Generated: 2026-03-28

## v1-to-v2-migration.md
- packages/v1/react-core/src/index.ts (v1 hook exports: useCopilotAction, useCopilotReadable, useCoAgent, useLangGraphInterrupt, useCopilotChat, useCopilotChatSuggestions, useCopilotAdditionalInstructions, useMakeCopilotDocumentReadable, CopilotKit provider)
- packages/v1/react-ui/src/index.ts (v1 component exports: CopilotChat, CopilotPopup, CopilotSidebar)
- packages/v1/react-textarea/src/index.ts (CopilotTextarea export, confirmed removed in v2)
- packages/v1/runtime/src/index.ts (v1 runtime exports: CopilotRuntime, OpenAIAdapter, AnthropicAdapter, GoogleGenerativeAIAdapter, LangChainAdapter, copilotRuntimeNextJSAppRouterEndpoint, copilotKitEndpoint)
- packages/v1/runtime-client-gql/src/index.ts (v1 GraphQL types: TextMessage, MessageRole, ActionExecutionMessage, ResultMessage)
- packages/v2/react/src/index.ts (v2 hook exports: useFrontendTool, useAgentContext, useAgent, useInterrupt, useSuggestions, useConfigureSuggestions, useRenderToolCall, useRenderActivityMessage, CopilotKitProvider)
- packages/v2/runtime/src/index.ts (v2 runtime exports: CopilotRuntime, createCopilotEndpoint, createCopilotEndpointExpress, CopilotKitIntelligence)
- packages/v2/agent/src/index.ts (v2 agent exports: BuiltInAgent, defineTool)
- packages/v2/core/src/ (CopilotKitCore, AG-UI event types, AbstractAgent interface)

## breaking-changes.md
- packages/v1/react-core/src/ (v1 provider props: CopilotKitProps, parameter descriptor format, FrontendAction type, ActionRenderProps)
- packages/v1/runtime/src/ (v1 service adapters, CopilotRuntime constructor with actions/remoteEndpoints, framework integration functions)
- packages/v1/shared/src/ (v1 Parameter type definition)
- packages/v2/react/src/ (v2 provider props: CopilotKitProviderProps, Zod parameter schemas, useFrontendTool available prop)
- packages/v2/runtime/src/ (v2 CopilotRuntime constructor with agents/middleware, createCopilotEndpoint Hono-based)
- packages/v2/core/src/ (AG-UI event types, message types replacing GraphQL types)
- packages/v2/agent/src/ (BuiltInAgent replacing all service adapters)

## deprecation-map.md
- packages/v1/react-core/src/index.ts (all v1 hook and component exports)
- packages/v1/react-ui/src/index.ts (all v1 UI component exports)
- packages/v1/react-textarea/src/index.ts (CopilotTextarea export)
- packages/v1/runtime/src/index.ts (all v1 runtime class and function exports)
- packages/v1/runtime-client-gql/src/index.ts (v1 GraphQL client exports)
- packages/v1/shared/src/index.ts (v1 shared type exports)
- packages/v1/sdk-js/src/index.ts (v1 SDK exports)
- packages/v2/react/src/index.ts (all v2 hook and component exports)
- packages/v2/runtime/src/index.ts (all v2 runtime exports)
- packages/v2/agent/src/index.ts (v2 agent exports)
- packages/v2/core/src/index.ts (v2 core exports)
- packages/v2/shared/src/index.ts (v2 shared type exports)
