# Agent Debugging Reference

## Agent Types in CopilotKit v2

| Agent Type | Package | Description |
|------------|---------|-------------|
| `BuiltInAgent` | `@copilotkit/agent` | Uses Vercel AI SDK `streamText` with configurable model providers |
| `LangGraphAgent` | `@ag-ui/langgraph` | Wraps a LangGraph deployment (Python or JS) |
| `A2AAgent` | Varies | Agent-to-Agent protocol agent |
| Custom `AbstractAgent` | `@ag-ui/client` | Any class extending `AbstractAgent` with a `run()` returning `Observable<BaseEvent>` |

## Agent Discovery Issues

### Agent Not Found

**Symptom**: `CopilotKitCoreErrorCode.agent_not_found` or `CopilotKitErrorCode.AGENT_NOT_FOUND`

**Diagnostic steps**:

1. Hit the `/info` endpoint to see registered agents:
   ```bash
   curl http://localhost:3001/api/copilotkit/info | jq .agents
   ```

2. Compare the agent names in the response with the `agentId` prop:
   ```tsx
   <CopilotChat agentId="myAgent" />
   // or
   const { run } = useAgent({ name: "myAgent" });
   ```

3. Check the runtime agent map -- keys must match exactly (case-sensitive):
   ```ts
   new CopilotRuntime({
     agents: {
       myAgent: new BuiltInAgent({ /* ... */ }),  // Key "myAgent" is the agent ID
     },
   });
   ```

4. If using lazy agent loading (`agents: Promise<...>`), check that the promise resolves successfully.

### Agent Constructor Failures

If an agent throws during construction, the runtime may start without it:

- **BuiltInAgent**: `resolveModel()` throws if the provider string is invalid (e.g., `"openai/"` without a model name, or `"unknown/model"`).
- **LangGraphAgent**: May fail if the LangGraph deployment URL is unreachable.
- **A2AAgent**: May fail if the A2A endpoint is misconfigured.

## AG-UI Event Tracing

### Event Flow for a Successful Run

```
RunStartedEvent
  -> TextMessageStartEvent (messageId)
  -> TextMessageChunkEvent (delta: "Hello")
  -> TextMessageChunkEvent (delta: " world")
  -> TextMessageEndEvent
RunFinishedEvent
```

### Event Flow with Tool Calls

```
RunStartedEvent
  -> TextMessageStartEvent
  -> TextMessageChunkEvent (delta: "Let me check...")
  -> TextMessageEndEvent
  -> ToolCallStartEvent (toolCallId, toolName)
  -> ToolCallArgsEvent (delta: '{"query": "weather"}')
  -> ToolCallEndEvent
  -> ToolCallResultEvent (result: '{"temp": 72}')
  -> TextMessageStartEvent
  -> TextMessageChunkEvent (delta: "The temperature is 72F")
  -> TextMessageEndEvent
RunFinishedEvent
```

### Event Flow with Errors

```
RunStartedEvent
  -> RunErrorEvent (message: "...")      // Non-fatal, run continues
  -> TextMessageStartEvent
  -> ...
RunFinishedEvent
```

Or for fatal errors:
```
RunStartedEvent
  -> RunErrorEvent (message: "...")      // Fatal
  // Stream ends without RunFinishedEvent
```

### Event Flow with State Sync

```
RunStartedEvent
  -> StateSnapshotEvent (snapshot: {...})    // Full state
  -> StateDeltaEvent (delta: [{op: "replace", path: "/count", value: 5}])
  -> TextMessageStartEvent
  -> ...
RunFinishedEvent
```

### Event Flow with Reasoning (Anthropic Extended Thinking)

```
RunStartedEvent
  -> ReasoningStartEvent
  -> ReasoningMessageStartEvent
  -> ReasoningMessageContentEvent (delta: "thinking...")
  -> ReasoningMessageEndEvent
  -> ReasoningEndEvent
  -> TextMessageStartEvent
  -> TextMessageChunkEvent
  -> TextMessageEndEvent
RunFinishedEvent
```

**Known issue**: Reasoning events can cause stalls if the client-side event handler does not consume them properly (issue #3323).

## State Synchronization Issues

### State Not Updating on Frontend

**Symptom**: Agent emits `StateSnapshotEvent` or `StateDeltaEvent` but the React component does not re-render.

**Diagnostic steps**:

1. Verify the agent is emitting state events -- check the SSE stream in the Network tab.
2. If using `useFrontendTool` with state, ensure the state shape matches what the component expects.
3. For LangGraph agents: verify `copilotkit_emit_state` events are reaching the frontend (see Python SDK event prefix mismatch, issue #3519).

### Context Not Reaching Agents

**Symptom**: Agent does not receive application context set via `useAgentContext` or similar hooks.

**Diagnostic steps**:

1. Context is sent as `forwardedProps` in the AG-UI `RunAgentInput`. Check the request body to `/agent/:id/run`.
2. For Mastra agents: context propagation through the middleware chain may not work correctly (issue #3426).
3. Verify that `useAgentContext` is called inside the `CopilotKitProvider` tree and before the agent runs.

## Tool Execution Issues

### Frontend Tool Not Found

**Error code**: `tool_not_found`

The agent called a tool name that does not match any registered frontend tool.

**Diagnostic steps**:

1. List registered tools by checking the AG-UI `Tool[]` array in the request to `/agent/:id/run`.
2. Ensure `useFrontendTool` is registered with the exact tool name (case-sensitive).
3. The tool must be registered BEFORE the agent run starts -- if it is registered lazily after mount, a race condition can occur.

### Tool Arguments Parse Failed

**Error code**: `tool_argument_parse_failed`

The LLM generated arguments that do not match the tool's parameter schema.

**Diagnostic steps**:

1. Check the `ToolCallArgsEvent` in the SSE stream -- the `delta` field contains the raw JSON.
2. Validate the JSON against the tool's schema (Zod or JSON Schema).
3. This is usually an LLM issue -- consider improving the tool description or parameter descriptions.
4. For Zod schema validation issues in backend actions, see issue #3198.

### Tool Handler Threw an Error

**Error code**: `tool_handler_failed`

The tool's `execute` function threw an exception.

**Diagnostic steps**:

1. Check the browser console for the error.
2. The `onError` callback in `CopilotChat` or `CopilotKitProvider` receives the error with context.
3. Wrap the tool handler in try/catch for better error reporting.

### Tool Call Succeeds But Agent Does Not Continue

**Symptom**: The tool returns a result but the agent does not produce a follow-up message.

**Diagnostic steps**:

1. Check that `ToolCallResultEvent` was emitted in the SSE stream after the tool completed.
2. For Human-in-the-Loop tools: the `runId` may change after HITL resolve (issue #3456), breaking the continuation.
3. For mixed frontend/backend tools: OpenAI may reject the request if tool definitions conflict (issue #3424).

## BuiltInAgent-Specific Issues

### Model Resolution Failures

`BuiltInAgent` uses `resolveModel()` to convert string identifiers to Vercel AI SDK `LanguageModel` instances.

Supported formats:
- `"openai/gpt-5"`, `"openai/gpt-4o"`, `"openai/o3-mini"`
- `"anthropic/claude-sonnet-4.5"`, `"anthropic/claude-opus-4"`
- `"google/gemini-2.5-pro"`, `"google/gemini-2.5-flash"`
- `"vertex/gemini-2.5-pro"` (uses Google Vertex AI)

Common errors:
- `Invalid model string "..."` -- Missing provider prefix or model name
- `Unknown provider "..." in "..."` -- Unsupported provider (only openai, anthropic, google, vertex)
- Missing API key -- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_API_KEY` not set in environment

### MCP Client Integration

`BuiltInAgent` supports MCP (Model Context Protocol) clients:

```ts
new BuiltInAgent({
  model: "openai/gpt-4o",
  mcpClients: [
    { type: "http", url: "http://localhost:8080" },
    { type: "sse", url: "http://localhost:8081/sse", headers: { "Authorization": "Bearer ..." } },
  ],
});
```

MCP debugging:
- `type: "http"` uses `StreamableHTTPClientTransport`
- `type: "sse"` uses `SSEClientTransport`
- If the MCP server is unreachable, the agent may fail silently or throw during tool discovery
- Check the MCP server logs for incoming connection attempts

## LangGraph Agent Issues

### Python SDK Event Name Mismatch

The CopilotKit Python SDK (v0.1.83) dispatches custom events with a `"copilotkit_"` prefix, but `ag-ui-langgraph` expects event names without that prefix. This causes `copilotkit_emit_message`, `copilotkit_emit_state`, and `copilotkit_emit_tool_call` to be silently dropped (issue #3519).

### LangGraph JS Template Outdated

The official LangGraph JS template may be outdated and incompatible with current CopilotKit versions (issue #3231). Check for the latest template version.

## Intelligence Mode Specific Issues

### Thread Operations

Intelligence mode uses the `CopilotKitIntelligence` client to manage threads:

- **409 Conflict on createThread**: Another request created the thread between get and create. Handled automatically by `getOrCreateThread`.
- **404 on getThread**: Thread does not exist. The client will create a new one.
- **Auth failures (401)**: Invalid `apiKey` or `tenantId` in the Intelligence configuration.

### WebSocket Connection Issues

Intelligence mode uses WebSocket for real-time events:

- Runner WebSocket: `{wsUrl}/runner` -- used by the runtime to communicate with the Intelligence platform
- Client WebSocket: `{wsUrl}/client` -- used by the frontend for real-time thread updates

If WebSocket connections fail:
1. Check that the `wsUrl` is correct (should start with `wss://`)
2. Verify the API key and tenant ID
3. Check for WebSocket-blocking proxies or firewalls
4. The URLs are auto-derived from the base `wsUrl` -- `/runner` and `/client` suffixes are appended automatically

## Web Inspector

The CopilotKit Web Inspector (`@copilotkit/web-inspector`) provides real-time visibility into:

- AG-UI events as they flow
- Error events with error codes
- Agent state snapshots
- Tool call lifecycle

Enable it during development:
```tsx
import { CopilotKitWebInspector } from "@copilotkit/web-inspector";

<CopilotKitProvider runtimeUrl="/api/copilotkit">
  <CopilotKitWebInspector />
  <YourApp />
</CopilotKitProvider>
```
