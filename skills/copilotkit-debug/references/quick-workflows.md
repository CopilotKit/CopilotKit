# Quick Diagnostic Workflows

## Workflow: "Runtime Not Connecting"

The client shows a connection error, banner error, or the chat never loads.

### Step 1: Verify the runtime is running

```bash
curl -v http://localhost:3001/api/copilotkit/info
```

- **No response / connection refused** -> The server is not running. Start it.
- **404** -> The basePath is wrong. Check `createCopilotEndpoint({ basePath })` vs the URL you are hitting.
- **500** -> The agent loading failed. Check server logs for the error.
- **200 with JSON** -> Runtime is up. Proceed to step 2.

### Step 2: Check the client configuration

```tsx
<CopilotKitProvider runtimeUrl="/api/copilotkit">
```

- Does `runtimeUrl` match the runtime's basePath exactly?
- If cross-origin (e.g., runtime on port 3001, app on port 3000), is CORS configured?
- If using a proxy (Next.js rewrites, nginx), does the proxy preserve the full path?

### Step 3: Check browser network tab

1. Look for the GET request to `/info`
2. If it is blocked by CORS, you will see a preflight OPTIONS failure
3. If it returns an error, the error body contains the `CopilotKitErrorCode`

### Step 4: Check package versions

```bash
npm ls @copilotkit/runtime @copilotkit/react @copilotkit/core @ag-ui/client
```

All `@copilotkit/*` packages should be the same version. Mismatches cause `VERSION_MISMATCH` errors.

### Step 5: Check CORS (if cross-origin)

Default CORS allows all origins without credentials. If you need credentials:

```ts
createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
  cors: {
    origin: "https://your-frontend.com",
    credentials: true,
  },
});
```

And on the client:
```tsx
<CopilotKitProvider runtimeUrl="https://your-api.com/api/copilotkit" credentials="include" />
```

---

## Workflow: "Agent Not Responding"

The chat connects but messages are never answered, or the agent returns an error.

### Step 1: Verify agent is registered

```bash
curl http://localhost:3001/api/copilotkit/info | jq '.agents'
```

Check that the agent name matches the `agentId` prop in `CopilotChat` or `useAgent`.

### Step 2: Check the SSE stream

1. Open browser DevTools > Network tab
2. Send a message in the chat
3. Find the POST to `/agent/:agentId/run`
4. Check the response:
   - **404** -> Agent not found in runtime
   - **500** -> Server error during agent execution
   - **200 with empty body** -> Agent started but produced no events
   - **200 with events** -> Check the events (step 3)

### Step 3: Inspect the event stream

Look at the SSE events in the response:

- **Only `RunStartedEvent` then nothing** -> Agent is stalled. Check server logs. Common causes:
  - Missing LLM API key (agent cannot call the model)
  - Agent waiting for a tool result that never comes
  - Reasoning event stall (Anthropic models, issue #3323)

- **`RunErrorEvent` present** -> Read the error message. Common causes:
  - LLM API returned an error (rate limit, invalid key, model not found)
  - Agent code threw an exception

- **`RunFinishedEvent` without text messages** -> Agent completed but produced no output. Check the agent's prompt and logic.

### Step 4: Check LLM API key

For `BuiltInAgent`, verify the environment variable:

| Provider | Environment Variable |
|----------|---------------------|
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Google | `GOOGLE_API_KEY` |
| Vertex | Application Default Credentials |

### Step 5: Check the agent's model string

```ts
new BuiltInAgent({
  model: "openai/gpt-4o",  // Must be "provider/model-name"
});
```

Invalid model strings throw `Error: Invalid model string "..."` or `Error: Unknown provider "..."`.

### Step 6: Check server-side logs

The SSE response handler logs errors with full stack traces:
```
Error running agent: <error>
Error stack: <stack trace>
Error details: { name, message, cause }
```

---

## Workflow: "Streaming Failures"

The agent starts responding but the stream cuts off, duplicates events, or corrupts messages.

### Step 1: Check for premature stream termination

1. Look at the SSE response in the Network tab
2. Does it end with `RunFinishedEvent`? If not:
   - **Connection closed mid-stream** -> Hosting platform timeout (Vercel: 30s default, Railway: 5min). Consider using Intelligence mode for long-running agents.
   - **Error in the stream** -> Check for `RunErrorEvent` before the cutoff
   - **Client navigated away** -> Expected behavior, the `abort` signal cleaned up the stream

### Step 2: Check for event ordering issues

Events must follow a logical sequence:
- `TextMessageStart` before `TextMessageChunk` before `TextMessageEnd`
- `ToolCallStart` before `ToolCallArgs` before `ToolCallEnd`
- `RunStarted` at the beginning, `RunFinished` at the end

If events are out of order, the issue is in the agent's Observable implementation.

### Step 3: Check for duplicate events

If the same message appears multiple times:
- **Message ID collision** -> Check issue #3410 (OpenAI-compatible providers reusing IDs)
- **Agent re-running** -> The `runId` changed mid-conversation. Check for HITL issues (issue #3456).

### Step 4: Check for message corruption

If message content is garbled or mixed:
- **Model-specific issue** -> DeepSeek and some models produce malformed streaming chunks (issue #3351)
- **Encoding issue** -> Verify the SSE response has `Content-Type: text/event-stream` and is UTF-8

### Step 5: Check hosting platform limits

| Platform | Default SSE Timeout | Notes |
|----------|-------------------|-------|
| Vercel (Serverless) | 30s (Hobby), 60s (Pro) | Use Edge Runtime or Intelligence mode |
| Vercel (Edge) | 30s | Better but still limited |
| Railway | 5 min | Usually sufficient |
| Render | 5 min | Usually sufficient |
| Self-hosted | No limit | Depends on reverse proxy config |

For long agent runs, consider:
- Intelligence mode (persisted threads, WebSocket updates)
- Increasing the platform timeout if possible
- Breaking the agent work into smaller runs

---

## Workflow: "Frontend Tool Not Working"

A frontend tool registered with `useFrontendTool` is not being called or not returning results.

### Step 1: Verify tool registration

Check that the tool is registered before the agent runs:
```tsx
useFrontendTool({
  name: "get_weather",           // Must match exactly what the agent calls
  description: "Get weather",
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => { /* ... */ },
});
```

### Step 2: Check the SSE stream for tool events

Look for `ToolCallStartEvent` in the SSE stream:
- **Not present** -> The agent decided not to call the tool. Check the tool description.
- **Present but no `ToolCallResultEvent`** -> The frontend did not respond. Check:
  - Is the component with `useFrontendTool` mounted?
  - Did the `execute` handler throw? (Check `tool_handler_failed` error)
  - Is the tool name an exact match (case-sensitive)?

### Step 3: Check tool argument parsing

If `tool_argument_parse_failed` error appears:
- The LLM generated arguments that do not match the Zod/JSON schema
- Check `ToolCallArgsEvent` for the raw arguments
- Consider relaxing the schema or improving parameter descriptions

### Step 4: Check HITL tool flow

For `renderAndWaitForResponse` tools:
- The tool renders UI and waits for user input
- If the tool does not execute after user confirmation, check issue #3442
- The `runId` may change after HITL resolve (issue #3456)

---

## Workflow: "Transcription Not Working"

Voice input fails or produces errors.

### Step 1: Check transcription service configuration

```ts
const runtime = new CopilotRuntime({
  agents: { /* ... */ },
  transcriptionService: myTranscriptionService,  // Must be provided
});
```

If not configured, the error code is `service_not_configured` (HTTP 503).

### Step 2: Check the `/info` response

```bash
curl http://localhost:3001/api/copilotkit/info | jq '.audioFileTranscriptionEnabled'
```

Should be `true`. If `false`, the transcription service is not configured.

### Step 3: Check browser microphone permissions

- The browser must grant microphone access
- `AudioRecorderError: "Microphone permission denied"` -> User denied permission
- `AudioRecorderError: "No microphone found"` -> No microphone hardware detected

### Step 4: Check transcription provider credentials

- `auth_failed` -> API key is invalid or expired
- `rate_limited` -> Too many requests, wait and retry
- `provider_error` -> Provider-side issue, check provider status page

### Step 5: Check audio format

- `invalid_audio_format` -> Browser sends unsupported format
- `audio_too_long` / `audio_too_short` -> Recording duration out of bounds

---

## Escalation Path

If the issue is unresolved after following these workflows:

1. **Check the CopilotKit GitHub Issues**: Search https://github.com/CopilotKit/CopilotKit/issues for your error message or symptom.

2. **Enable the Web Inspector**: Add `<CopilotKitWebInspector />` to capture detailed event traces.

3. **Collect a diagnostic bundle**:
   - Package versions (`npm ls @copilotkit/*`)
   - Runtime `/info` response
   - SSE stream capture (copy from Network tab)
   - Server-side error logs
   - Browser console errors

4. **File a GitHub issue**: https://github.com/CopilotKit/CopilotKit/issues/new with the diagnostic bundle.

5. **Reach out to the CopilotKit team**: Book time with the CopilotKit team via their Discord (https://discord.gg/copilotkit) or contact support for urgent production issues.
