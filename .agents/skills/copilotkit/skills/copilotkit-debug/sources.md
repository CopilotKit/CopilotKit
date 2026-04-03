# Sources

Files and directories read from CopilotKit/CopilotKit to generate this skill's references.
Generated: 2026-03-28

## error-patterns.md
- packages/v1/shared/src/utils/errors.ts (CopilotKitErrorCode enum, all v1 error classes: CopilotKitError, CopilotKitMisuseError, CopilotKitVersionMismatchError, CopilotKitApiDiscoveryError, CopilotKitRemoteEndpointDiscoveryError, CopilotKitAgentDiscoveryError, CopilotKitLowLevelError, ResolvedCopilotKitError, ConfigurationError, MissingPublicApiKeyError, UpgradeRequiredError)
- packages/v2/core/src/core/core.ts (CopilotKitCoreErrorCode enum: runtime_info_fetch_failed, agent_connect_failed, agent_run_failed, tool_argument_parse_failed, tool_handler_failed, tool_not_found, agent_not_found, transcription error codes)
- packages/v2/shared/src/transcription-errors.ts (TranscriptionErrorCode enum)
- packages/v2/runtime/src/intelligence-platform/client.ts (PlatformRequestError, HTTP status codes 404/409/401/500)
- GitHub issues: #3519, #3510, #3323, #3442, #3170, #3217, #3424, #3426, #3429, #3318, #3410

## runtime-debugging.md
- packages/v2/runtime/src/ (CopilotRuntime, endpoint factories, route definitions, SSE streaming, /info endpoint response shape)
- packages/v2/runtime/src/endpoints/ (CORS configuration, Hono middleware, Express middleware)
- packages/v2/runtime/src/intelligence-platform/ (CopilotKitIntelligence, IntelligenceAgentRunner, WebSocket URLs)
- packages/v2/runtime/src/runner/ (InMemoryAgentRunner, AgentRunner abstract class)
- packages/v2/react/src/ (CopilotKitProvider props: runtimeUrl, credentials, headers)
- GitHub issues: #3170, #3425

## agent-debugging.md
- packages/v2/agent/src/ (BuiltInAgent, resolveModel, model string formats, MCP client configuration)
- packages/v2/runtime/src/ (AgentRunner, agent registry, /info endpoint agent discovery)
- packages/v2/core/src/ (CopilotKitCoreErrorCode, tool registry, onError subscriber)
- packages/v2/react/src/ (useFrontendTool, useAgent, CopilotChat agentId prop)
- packages/v2/web-inspector/src/ (CopilotKitWebInspector component)
- GitHub issues: #3323, #3519, #3231, #3456, #3424, #3426, #3198

## quick-workflows.md
- packages/v2/runtime/src/ (endpoint route structure, /info endpoint, CORS defaults, SSE event flow)
- packages/v2/agent/src/ (BuiltInAgent model string format, environment variable conventions)
- packages/v2/core/src/ (error codes referenced in diagnostic steps)
- packages/v2/react/src/ (CopilotKitProvider props, useFrontendTool registration, CopilotChat)
- packages/v2/shared/src/ (TranscriptionErrorCode, transcription service configuration)
- packages/v2/web-inspector/src/ (CopilotKitWebInspector for escalation)
