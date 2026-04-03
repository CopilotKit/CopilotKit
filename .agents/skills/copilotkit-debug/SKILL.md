---
name: copilotkit-debug
description: "Use when diagnosing CopilotKit issues -- runtime connectivity failures, agent not responding, streaming errors, tool execution problems, transcription failures, version mismatches, and AG-UI event tracing."
---

# CopilotKit Debugging Skill

## When to Use

Invoke this skill when:
- The CopilotKit runtime is unreachable or returning errors
- Agents fail to connect, respond, or stream events
- Frontend tools are not executing or returning results
- Transcription (voice) is failing
- Version mismatch errors appear between packages
- AG-UI SSE events are malformed or missing
- CORS errors block browser requests to the runtime

## Diagnostic Workflow

### Step 1: Gather Information

Before proposing any fix, collect:

1. **Package versions** -- Run `npm ls @copilotkit/runtime @copilotkit/react @copilotkit/core @ag-ui/client` (or the v1 equivalents). Version mismatches between runtime and react packages are a common root cause.
2. **Runtime mode** -- Is this SSE mode (`CopilotSseRuntime`) or Intelligence mode (`CopilotIntelligenceRuntime`)? Check the runtime constructor.
3. **Transport configuration** -- What is `runtimeUrl` set to in `CopilotKitProvider`? Does it match the `basePath` in `createCopilotEndpoint`?
4. **Agent type** -- Is the agent a `BuiltInAgent`, `LangGraphAgent`, `A2AAgent`, or custom `AbstractAgent`?
5. **Error messages** -- Collect the exact error from browser console and server logs. CopilotKit uses structured error codes (see `references/error-patterns.md`).
6. **Browser network tab** -- Check the `/info` request (runtime discovery), the `/agent/:id/run` SSE stream, and any CORS preflight failures.

### Step 2: Check Logs and Error Codes

CopilotKit has three error code systems:

- **V1 `CopilotKitErrorCode`** -- Legacy error codes from the v1 runtime layer (`@copilotkit/runtime`). Codes like `NETWORK_ERROR`, `AGENT_NOT_FOUND`, `API_NOT_FOUND`. Still surfaced in some contexts since `@copilotkit/*` packages wrap v2 internally.
- **V2 `CopilotKitCoreErrorCode`** -- Used by `@copilotkit/core`. Codes like `runtime_info_fetch_failed`, `agent_connect_failed`, `agent_run_failed`.
- **`TranscriptionErrorCode`** -- Used by both v1 and v2 for voice transcription. Codes like `service_not_configured`, `rate_limited`, `auth_failed`.

Match the error code to the catalog in `references/error-patterns.md` for root cause and resolution.

### Step 3: Trace AG-UI Events

For streaming/agent issues, trace the AG-UI event flow:

1. **RunStartedEvent** -- Confirms the agent run was initiated
2. **TextMessageStartEvent / TextMessageChunkEvent / TextMessageEndEvent** -- Text streaming
3. **ToolCallStartEvent / ToolCallArgsEvent / ToolCallEndEvent** -- Tool invocations
4. **ToolCallResultEvent** -- Tool results flowing back
5. **StateSnapshotEvent / StateDeltaEvent** -- Agent state synchronization
6. **ReasoningStartEvent / ReasoningMessageContentEvent / ReasoningMessageEndEvent** -- Reasoning tokens (can cause stalls, see issue #3323)
7. **RunFinishedEvent** -- Successful completion
8. **RunErrorEvent** -- Agent-level error

Enable the CopilotKit Web Inspector (`@copilotkit/web-inspector`) to see events in real time. Or check the SSE stream directly in the browser Network tab -- each event is a `data:` line in the `text/event-stream` response.

### Step 4: Identify Root Cause

Use the reference documents to match symptoms to known issues:

- **`references/runtime-debugging.md`** -- Connectivity, CORS, transport, SSE streaming
- **`references/agent-debugging.md`** -- Agent discovery, state sync, tool execution, AG-UI protocol
- **`references/error-patterns.md`** -- Complete error code catalog with resolutions
- **`references/quick-workflows.md`** -- Step-by-step diagnostic sequences for common scenarios

### Step 5: Fix and Verify

1. Apply the fix
2. Verify the `/info` endpoint returns the expected agent list
3. Confirm the SSE stream produces a complete event sequence (RunStarted through RunFinished)
4. Check the browser console for any remaining structured errors

## Using mcp-docs for Live Documentation Lookups

During debugging, use the `copilotkit-docs` MCP server to look up the latest CopilotKit documentation. This server provides two tools: `search-docs` (search documentation) and `search-code` (search source code examples).

### MCP Setup

**Claude Code:** The MCP server is auto-configured by the plugin's `.mcp.json` -- no manual setup needed. The agent can call the `search-docs` and `search-code` tools from the `copilotkit-docs` server directly.

**Codex:** Add the following to your `.codex/config.toml`:

```toml
[mcp_servers.copilotkit-docs]
type = "http"
url = "https://mcp.copilotkit.ai/mcp"
```

### Tool Usage

The `search-docs` and `search-code` tools are invoked as MCP tool calls (not CLI commands). Examples of what to search for during debugging:

```
search-docs("AGENT_NOT_FOUND")
search-docs("CopilotRuntime configuration")
search-docs("AG-UI protocol events")
search-docs("troubleshooting common issues")
search-docs("CORS configuration copilotkit")
search-code("CopilotRuntime error handling")
```

The official troubleshooting docs are at:
- `https://docs.copilotkit.ai/troubleshooting/common-issues`
- `https://docs.copilotkit.ai/coagents/troubleshooting/common-issues`

## Key File Locations in the CopilotKit Codebase

| Component | Path |
|-----------|------|
| V1 Error classes & codes | `packages/v1/shared/src/utils/errors.ts` |
| V2 Core error codes | `packages/v2/core/src/core/core.ts` (`CopilotKitCoreErrorCode` enum) |
| V2 Transcription errors | `packages/v2/shared/src/transcription-errors.ts` |
| Runtime SSE response | `packages/v2/runtime/src/handlers/shared/sse-response.ts` |
| Runtime info endpoint | `packages/v2/runtime/src/handlers/get-runtime-info.ts` |
| Runtime CORS config | `packages/v2/runtime/src/endpoints/hono.ts` |
| Intelligence platform client | `packages/v2/runtime/src/intelligence-platform/client.ts` |
| Agent package (BuiltInAgent) | `packages/v2/agent/src/index.ts` |
| Web Inspector | `packages/v2/web-inspector/src/index.ts` |
