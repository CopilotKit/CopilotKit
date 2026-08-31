# Sources

Files and directories read from CopilotKit/CopilotKit to generate this skill's references.
Generated: 2026-03-28

## error-patterns.md

- packages/shared/src/utils/errors.ts (CopilotKitErrorCode enum, all legacy v1 error classes: CopilotKitError, CopilotKitMisuseError, CopilotKitVersionMismatchError, CopilotKitApiDiscoveryError, CopilotKitRemoteEndpointDiscoveryError, CopilotKitAgentDiscoveryError, CopilotKitLowLevelError, ResolvedCopilotKitError, ConfigurationError, MissingPublicApiKeyError, UpgradeRequiredError)
- packages/core/src/core/core.ts (CopilotKitCoreErrorCode enum: runtime_info_fetch_failed, agent_connect_failed, agent_run_failed, tool_argument_parse_failed, tool_handler_failed, tool_not_found, agent_not_found, transcription error codes)
- packages/shared/src/transcription-errors.ts (TranscriptionErrorCode enum)
- packages/runtime/src/v2/runtime/intelligence-platform/client.ts (PlatformRequestError, HTTP status codes 404/409/401/500)
- GitHub issues: #3519, #3510, #3323, #3442, #3170, #3217, #3424, #3426, #3429, #3318, #3410

## runtime-debugging.md

- packages/runtime/src/v2/runtime/ (CopilotRuntime, endpoint factories, route definitions, SSE streaming, /info endpoint response shape)
- packages/runtime/src/v2/runtime/endpoints/ (CORS configuration, Hono middleware, Express middleware)
- packages/runtime/src/v2/runtime/intelligence-platform/ (CopilotKitIntelligence, IntelligenceAgentRunner, WebSocket URLs)
- packages/runtime/src/v2/runtime/runner/ (InMemoryAgentRunner, AgentRunner abstract class)
- packages/react-core/src/v2/ (`CopilotKit` provider props: runtimeUrl, credentials, headers)
- GitHub issues: #3170, #3425

## agent-debugging.md

- packages/runtime/src/agent/ (BuiltInAgent, resolveModel, model string formats, MCP client configuration)
- packages/runtime/src/v2/runtime/ (AgentRunner, agent registry, /info endpoint agent discovery)
- packages/core/src/ (CopilotKitCoreErrorCode, tool registry, onError subscriber)
- packages/react-core/src/v2/ (useFrontendTool, useAgent, CopilotChat agentId prop)
- packages/web-inspector/src/ (CopilotKitWebInspector component)
- GitHub issues: #3323, #3519, #3231, #3456, #3424, #3426, #3198

## quick-workflows.md

- packages/runtime/src/v2/runtime/ (endpoint route structure, /info endpoint, CORS defaults, SSE event flow)
- packages/runtime/src/agent/ (BuiltInAgent model string format, environment variable conventions)
- packages/core/src/ (error codes referenced in diagnostic steps)
- packages/react-core/src/v2/ (`CopilotKit` provider props, useFrontendTool registration, CopilotChat)
- packages/shared/src/ (TranscriptionErrorCode, transcription service configuration)
- packages/web-inspector/src/ (CopilotKitWebInspector for escalation)
