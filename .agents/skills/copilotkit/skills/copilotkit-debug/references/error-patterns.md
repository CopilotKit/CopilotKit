# CopilotKit Error Pattern Catalog

## V1 Error Codes (`CopilotKitErrorCode`)

Legacy error codes from the v1 runtime layer. These still surface in `@copilotkit/*` packages since they wrap v2 internally. Defined in `packages/v1/shared/src/utils/errors.ts`.

### NETWORK_ERROR
- **HTTP Status**: 503
- **Severity**: CRITICAL (banner)
- **Cause**: Server unreachable, DNS failure, connection timeout, SSL/TLS issues
- **Resolution**: Verify the runtime server is running and accessible. Check `runtimeUrl` in `CopilotKitProvider`. Common sub-causes:
  - `ECONNREFUSED` -- Server not running on the expected port
  - `ENOTFOUND` -- DNS cannot resolve the hostname
  - `ETIMEDOUT` -- Server overloaded or network issues
- **Docs**: https://docs.copilotkit.ai/troubleshooting/common-issues#i-am-getting-a-network-errors--api-not-found

### NOT_FOUND
- **HTTP Status**: 404
- **Severity**: CRITICAL (banner)
- **Cause**: The runtime URL returns 404. Wrong basePath or the server is not serving CopilotKit at that path.
- **Resolution**: Ensure `basePath` in `createCopilotEndpoint()` matches the `runtimeUrl` in the provider.
- **Docs**: https://docs.copilotkit.ai/troubleshooting/common-issues#i-am-getting-a-network-errors--api-not-found

### AGENT_NOT_FOUND
- **HTTP Status**: 500
- **Severity**: CRITICAL (banner)
- **Cause**: The requested agent name does not exist in the runtime's agent registry.
- **Resolution**: Verify the agent name matches between `CopilotChat agentId` and the runtime's `agents` map. The error message lists available agents.
- **Docs**: https://docs.copilotkit.ai/coagents/troubleshooting/common-issues#i-am-getting-agent-not-found-error

### API_NOT_FOUND
- **HTTP Status**: 404
- **Severity**: CRITICAL (banner)
- **Cause**: The CopilotKit API endpoint itself cannot be discovered. Usually a routing/basePath mismatch.
- **Resolution**: Check that the runtime's Hono/Express app is mounted at the correct path. The error includes the URL that failed.
- **Docs**: https://docs.copilotkit.ai/troubleshooting/common-issues#i-am-getting-a-network-errors--api-not-found

### REMOTE_ENDPOINT_NOT_FOUND
- **HTTP Status**: 404
- **Severity**: CRITICAL (banner)
- **Cause**: A remote endpoint specified in the runtime configuration cannot be contacted.
- **Resolution**: Verify the remote endpoint URL is correct and the service is running. Check firewall/network rules.
- **Docs**: https://docs.copilotkit.ai/troubleshooting/common-issues#i-am-getting-copilotkits-remote-endpoint-not-found-error

### AUTHENTICATION_ERROR
- **HTTP Status**: 401
- **Severity**: CRITICAL (banner)
- **Cause**: Authentication failed when contacting the runtime or a remote service.
- **Resolution**: Check API keys, tokens, and authentication headers.
- **Docs**: https://docs.copilotkit.ai/troubleshooting/common-issues#authentication-errors

### VERSION_MISMATCH
- **HTTP Status**: 400
- **Severity**: INFO (dev only)
- **Cause**: `@copilotkit/*` packages are on different versions.
- **Resolution**: Ensure all `@copilotkit/*` packages are the same version. Run `npm ls @copilotkit/runtime @copilotkit/react`.

### CONFIGURATION_ERROR
- **HTTP Status**: 400
- **Severity**: WARNING (banner)
- **Cause**: Invalid runtime or provider configuration.
- **Resolution**: Review the CopilotRuntime and CopilotKitProvider configuration.

### MISSING_PUBLIC_API_KEY_ERROR
- **HTTP Status**: 400
- **Severity**: CRITICAL (banner)
- **Cause**: The `publicApiKey` prop is missing from `CopilotKitProvider` when using CopilotKit Cloud.
- **Resolution**: Add `publicApiKey` to the provider, or switch to self-hosted mode with `runtimeUrl`.

### UPGRADE_REQUIRED_ERROR
- **HTTP Status**: 402
- **Severity**: WARNING (banner)
- **Cause**: The current plan does not support the requested feature.
- **Resolution**: Upgrade the CopilotKit plan or remove the feature flag.

### MISUSE
- **HTTP Status**: 400
- **Severity**: WARNING (dev only)
- **Cause**: Incorrect API usage detected at development time (e.g., using a hook outside its provider).
- **Resolution**: Follow the error message guidance -- typically a component is being used outside the required provider.

### UNKNOWN
- **HTTP Status**: 500
- **Severity**: CRITICAL (toast)
- **Cause**: Unclassified server error.
- **Resolution**: Check server logs for the underlying exception.

---

## V1 Error Classes

All defined in `packages/v1/shared/src/utils/errors.ts`:

| Class | Extends | When Thrown |
|-------|---------|------------|
| `CopilotKitError` | `GraphQLError` | Base class for all structured errors |
| `CopilotKitMisuseError` | `CopilotKitError` | Wrong usage of components/hooks |
| `CopilotKitVersionMismatchError` | `CopilotKitError` | Package version incompatibility |
| `CopilotKitApiDiscoveryError` | `CopilotKitError` | Runtime endpoint not found (404, routing) |
| `CopilotKitRemoteEndpointDiscoveryError` | `CopilotKitApiDiscoveryError` | Remote agent endpoint unreachable |
| `CopilotKitAgentDiscoveryError` | `CopilotKitError` | Named agent not in registry |
| `CopilotKitLowLevelError` | `CopilotKitError` | Pre-HTTP errors (DNS, connection refused) |
| `ResolvedCopilotKitError` | `CopilotKitError` | HTTP error responses (status-code based) |
| `ConfigurationError` | `CopilotKitError` | Invalid configuration |
| `MissingPublicApiKeyError` | `ConfigurationError` | Cloud mode without API key |
| `UpgradeRequiredError` | `ConfigurationError` | Plan limitation |

---

## V2 Error Codes (`CopilotKitCoreErrorCode`)

Used by `@copilotkit/core`. Defined in `packages/v2/core/src/core/core.ts`. These are emitted via the `onError` subscriber callback.

### runtime_info_fetch_failed
- **Cause**: The `/info` endpoint returned an error or was unreachable.
- **Resolution**: Verify `runtimeUrl` points to a running CopilotRuntime. Check CORS if cross-origin. The `/info` endpoint must return agent metadata and runtime version.

### agent_connect_failed
- **Cause**: WebSocket or HTTP connection to the agent failed during the connect phase.
- **Resolution**: For Intelligence mode, verify the WebSocket URL (`wsUrl`) is correct. For SSE mode, check that the agent exists in the runtime.

### agent_run_failed
- **Cause**: The agent run threw an exception before completing.
- **Resolution**: Check server-side logs for the agent execution error. Common causes: missing API keys for the LLM provider, invalid model configuration.

### agent_run_failed_event
- **Cause**: The AG-UI stream contained a `RunFailedEvent` (the agent explicitly signaled failure).
- **Resolution**: The event payload contains the failure reason. Check the agent's implementation for error handling.

### agent_run_error_event
- **Cause**: The AG-UI stream contained a `RunErrorEvent` (non-fatal error during the run).
- **Resolution**: Check the error message in the event. May be transient -- the agent might recover.

### tool_argument_parse_failed
- **Cause**: The JSON arguments for a frontend tool call could not be parsed.
- **Resolution**: Check the tool's parameter schema. The LLM may have generated malformed JSON.

### tool_handler_failed
- **Cause**: A frontend tool's `execute` handler threw an exception.
- **Resolution**: Check the tool's handler code. The error is caught and reported via `onError`.

### tool_not_found
- **Cause**: The agent called a tool that is not registered in the frontend.
- **Resolution**: Ensure `useFrontendTool` is registered with the correct name before the agent runs.

### agent_not_found
- **Cause**: The `agentId` passed to `CopilotChat` or `useAgent` does not match any agent in the runtime.
- **Resolution**: Check the runtime's `/info` endpoint to see available agents. Match the `agentId` prop.

### transcription_failed
- **Cause**: Generic transcription failure.
- **Resolution**: See TranscriptionErrorCode section below for specific sub-codes.

### transcription_service_not_configured
- **Cause**: Voice transcription requested but no `transcriptionService` configured in the runtime.
- **Resolution**: Add a transcription service to the runtime constructor.

### transcription_invalid_audio
- **Cause**: Audio format not supported by the transcription provider.
- **Resolution**: Check supported audio formats (typically webm, wav, mp3).

### transcription_rate_limited
- **Cause**: Transcription provider rate limit exceeded.
- **Resolution**: Wait and retry. Consider caching or reducing request frequency.

### transcription_auth_failed
- **Cause**: Authentication with the transcription provider failed.
- **Resolution**: Check the transcription API key configuration.

### transcription_network_error
- **Cause**: Network error during transcription API call.
- **Resolution**: Check connectivity to the transcription provider.

---

## Transcription Error Codes (`TranscriptionErrorCode`)

Used by `@copilotkit/shared` and `@copilotkit/react`. Defined in `packages/v2/shared/src/transcription-errors.ts`.

| Code | Retryable | Description |
|------|-----------|-------------|
| `service_not_configured` | No | No transcription service in runtime |
| `invalid_audio_format` | No | Unsupported audio format |
| `audio_too_long` | No | Audio file exceeds maximum duration |
| `audio_too_short` | No | Audio too short to transcribe |
| `rate_limited` | Yes | Provider rate limit hit |
| `auth_failed` | No | Provider authentication failed |
| `provider_error` | Yes | Provider returned an error |
| `network_error` | Yes | Network failure during transcription |
| `invalid_request` | No | Malformed request to transcription endpoint |

---

## Intelligence Platform Error (`PlatformRequestError`)

Used by `@copilotkit/runtime` for Intelligence mode. Defined in `packages/v2/runtime/src/intelligence-platform/client.ts`.

| Status | Meaning |
|--------|---------|
| 404 | Thread not found |
| 409 | Thread already exists (race condition -- handled automatically by `getOrCreateThread`) |
| 401 | Invalid API key or tenant ID |
| 500 | Platform server error |

---

## Common GitHub-Reported Issues

These are frequently reported bugs from the CopilotKit issue tracker:

### Event Name Prefix Mismatch (Python SDK + ag-ui-langgraph)
- **Issue**: [#3519](https://github.com/CopilotKit/CopilotKit/issues/3519)
- **Symptom**: `copilotkit_emit_message`, `copilotkit_emit_state`, `copilotkit_emit_tool_call` never reach the frontend
- **Cause**: Python SDK dispatches events with `"copilotkit_"` prefix but `ag-ui-langgraph` expects names without the prefix
- **Resolution**: Update `ag-ui-langgraph` or patch the event name mapping

### Tool Call Failing Silently
- **Issue**: [#3510](https://github.com/CopilotKit/CopilotKit/issues/3510)
- **Symptom**: `defineTool` tool calls fail without error or response
- **Resolution**: Check tool parameter schema validation and network responses

### Reasoning Events Cause Agent Stall
- **Issue**: [#3323](https://github.com/CopilotKit/CopilotKit/issues/3323)
- **Symptom**: Agent stalls permanently after Anthropic reasoning/thinking tokens
- **Cause**: `REASONING_*` events in the AG-UI SSE stream are not handled correctly
- **Resolution**: Update to a version with reasoning event handling fixes

### HITL Frontend Tool Not Executing After Confirmation
- **Issue**: [#3442](https://github.com/CopilotKit/CopilotKit/issues/3442)
- **Symptom**: `useFrontendTool` with `renderAndWaitForResponse` does not execute after user confirms
- **Resolution**: Check the HITL flow implementation and `runId` consistency (related: #3456)

### Authorization Header Not Passed to A2A Agents
- **Issue**: [#3170](https://github.com/CopilotKit/CopilotKit/issues/3170)
- **Symptom**: Auth headers from the client do not reach agents using A2A protocol
- **Resolution**: Verify header forwarding configuration in runtime middleware

### LangChainAdapter Regression ("Unknown provider undefined")
- **Issue**: [#3217](https://github.com/CopilotKit/CopilotKit/issues/3217)
- **Symptom**: `LangChainAdapter` throws "Unknown provider undefined" in v1.50.0+
- **Cause**: Custom adapters without `provider`/`model` properties hit a code path that assumes they exist
- **Resolution**: Migrate to v2 `BuiltInAgent` or add `.provider`/`.model` to the adapter

### Mixed Frontend and Backend Tool Execution Fails
- **Issue**: [#3424](https://github.com/CopilotKit/CopilotKit/issues/3424)
- **Symptom**: OpenAI `BadRequestError` when mixing frontend and backend tools with LangGraph
- **Resolution**: Check tool registration and ensure tools are not duplicated across frontend and backend

### Context Not Updated with Mastra Integration
- **Issue**: [#3426](https://github.com/CopilotKit/CopilotKit/issues/3426)
- **Symptom**: Context state does not propagate to Mastra agents
- **Resolution**: Verify context is being passed through the runtime middleware chain

### Subscribe Null Reference in A2A/A2UI
- **Issue**: [#3429](https://github.com/CopilotKit/CopilotKit/issues/3429)
- **Symptom**: `Cannot read properties of null (reading 'subscribe')` during A2A integration
- **Resolution**: Check agent lifecycle and ensure proper initialization order

### IME Input Cleared on Mobile (v2)
- **Issue**: [#3318](https://github.com/CopilotKit/CopilotKit/issues/3318)
- **Symptom**: Typing with IME on mobile devices clears input in CopilotChat
- **Resolution**: Known v2 issue with controlled input handling during IME composition

### Message ID Collision with OpenAI-Compatible Providers
- **Issue**: [#3410](https://github.com/CopilotKit/CopilotKit/issues/3410)
- **Symptom**: All messages share the same ID when using `@ai-sdk/openai-compatible`
- **Cause**: Default message ID from the compatible provider is not unique
- **Resolution**: Update to a patched version or use the native OpenAI provider
