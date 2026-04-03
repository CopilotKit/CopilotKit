# Runtime Debugging Reference

## Runtime Architecture

CopilotKit v2 runtime (`@copilotkit/runtime`) runs as a Hono HTTP server. It exposes these endpoints under the configured `basePath`:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/info` | GET | Runtime discovery -- returns version, agent list, capabilities |
| `/agent/:agentId/run` | POST | Start an agent run, returns SSE event stream |
| `/agent/:agentId/connect` | POST | Connect to an existing agent run (Intelligence mode) |
| `/agent/:agentId/stop` | POST | Stop a running agent |
| `/transcribe` | POST | Audio transcription |
| `/threads` | GET/POST/PATCH/DELETE | Thread management (Intelligence mode only) |

## Runtime Modes

### SSE Mode (`"sse"`)
- Default mode. Agent runs are ephemeral.
- Each `/agent/:id/run` request creates a new run and streams AG-UI events as SSE.
- Uses `InMemoryAgentRunner` by default.
- No thread persistence -- state lives only for the duration of the SSE connection.

### Intelligence Mode (`"intelligence"`)
- Requires `CopilotKitIntelligence` configuration with `apiUrl`, `wsUrl`, `apiKey`, `tenantId`.
- Agent runs are durable -- threads are persisted on the Intelligence platform.
- Uses `IntelligenceAgentRunner` which coordinates via WebSocket.
- Supports thread listing, archiving, deletion, and real-time updates.
- Requires `identifyUser` callback to resolve authenticated users.

## Connectivity Debugging

### "Runtime not found" / 404 Errors

1. **Verify the runtime is running**: Hit the `/info` endpoint directly:
   ```bash
   curl http://localhost:3001/api/copilotkit/info
   ```
   Expected response: JSON with `version`, `agents`, `mode` fields.

2. **Check basePath alignment**: The `basePath` in `createCopilotEndpoint()` must match the `runtimeUrl` in `CopilotKitProvider`:
   ```ts
   // Server
   createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });

   // Client
   <CopilotKitProvider runtimeUrl="/api/copilotkit">
   ```

3. **Check the Hono app mounting**: If using a framework adapter (Next.js, Express), ensure the Hono app is mounted at the right path. The framework's route path combined with `basePath` must form the full URL.

4. **Proxy/reverse proxy issues**: If running behind nginx, Vercel, or similar, ensure the proxy passes the full path and does not strip the prefix.

### Connection Refused (ECONNREFUSED)

- The runtime server is not running on the expected host:port.
- Check `process.env.PORT` or the server's listen configuration.
- If using Docker, ensure the port is exposed and the container is running.

### DNS Resolution Failed (ENOTFOUND)

- The hostname in `runtimeUrl` cannot be resolved.
- Check for typos in the URL.
- If using service discovery (Kubernetes, Docker Compose), verify the service name is correct.

### Timeout (ETIMEDOUT)

- Server is reachable but not responding in time.
- Check server load and resource limits.
- Increase timeout if the agent's first response takes a while (large model, cold start).

## CORS Debugging

### Default CORS Behavior

When no `cors` option is provided to `createCopilotEndpoint`, the runtime defaults to:
- `origin: "*"` (all origins allowed)
- `credentials: false`
- All standard HTTP methods allowed
- All headers allowed

### CORS with Credentials (HTTP-only Cookies)

When using HTTP-only cookies for authentication, you must configure CORS explicitly:

```ts
createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
  cors: {
    origin: "https://myapp.com",  // Must be explicit, not "*"
    credentials: true,
  },
});
```

On the client side, enable credentials:
```tsx
<CopilotKitProvider
  runtimeUrl="https://api.myapp.com/api/copilotkit"
  credentials="include"
/>
```

### Common CORS Errors

| Browser Error | Cause | Fix |
|---------------|-------|-----|
| "No 'Access-Control-Allow-Origin' header" | Runtime not sending CORS headers | Verify `createCopilotEndpoint` is handling the request (not a 404 from another handler) |
| "Credential is not supported if origin is '*'" | `credentials: true` with wildcard origin | Set an explicit `origin` in the CORS config |
| "Method PUT is not allowed" | Preflight failure | Ensure the runtime's CORS allows the method (default config allows all) |
| CORS error only in production | Different origins in dev vs prod | Update the `origin` config for the production domain |

### Diagnosing CORS Issues

1. Open browser DevTools Network tab
2. Look for a failed OPTIONS (preflight) request to the runtime URL
3. Check the response headers -- `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials`, `Access-Control-Allow-Headers`
4. If no OPTIONS request appears, the browser may be making a "simple request" that still fails on the response headers

## SSE Streaming Debugging

### How SSE Works in CopilotKit

The `/agent/:agentId/run` endpoint returns an SSE response:
- Content-Type: `text/event-stream`
- Cache-Control: `no-cache`
- Connection: `keep-alive`

Events are encoded using `@ag-ui/encoder` (the `EventEncoder` class). Each event is a `data:` line in SSE format.

### Stream Never Starts

- **Agent not found**: The agent ID in the URL does not match any registered agent. Check the `/info` endpoint.
- **Middleware blocking**: A `beforeRequestMiddleware` might be throwing or returning an error response before the agent runs.
- **Agent constructor failure**: The agent's initialization might throw (e.g., missing API key). Check server-side logs.

### Stream Starts but Hangs

- **Agent waiting for tool result**: If the agent calls a frontend tool and the frontend does not respond, the stream will appear hung. Check that frontend tools are registered and responding.
- **Reasoning event stall**: Anthropic models with reasoning/thinking tokens can cause stalls if the event handler does not properly process `REASONING_*` events (issue #3323).
- **Backpressure**: If the client reads slowly, the `TransformStream` writer may block. This is rare with SSE but possible with very high event rates.

### Stream Ends Prematurely

- **Client disconnect**: If the browser tab is closed or the network drops, the `request.signal` aborts and the subscription is cleaned up.
- **Agent error**: An uncaught exception in the agent terminates the observable. Check for `RunErrorEvent` before the stream closes.
- **Server timeout**: Some hosting platforms (Vercel, Railway) have response timeouts. Long-running agent interactions may hit these limits.

### Debugging SSE in the Browser

1. Open DevTools > Network tab
2. Find the POST request to `/agent/:id/run`
3. Click the "EventStream" tab (Chrome) or check the Response tab for raw SSE data
4. Each event should be formatted as:
   ```
   data: {"type":"RunStarted","runId":"..."}

   data: {"type":"TextMessageStart","messageId":"..."}

   data: {"type":"TextMessageChunk","delta":"Hello"}
   ```
5. If events stop flowing, the issue is server-side (agent stalled or errored)

## Runtime Info Endpoint Debugging

The `/info` endpoint is the first request the client makes. If it fails, no agent interaction is possible.

### Expected Response Shape

```json
{
  "version": "1.52.0",
  "agents": {
    "myAgent": {
      "name": "myAgent",
      "description": "My agent description",
      "className": "BuiltInAgent"
    }
  },
  "audioFileTranscriptionEnabled": false,
  "mode": "sse",
  "a2uiEnabled": false
}
```

For Intelligence mode, the response also includes:
```json
{
  "intelligence": {
    "wsUrl": "wss://api.copilotkit.ai/client"
  }
}
```

### Common `/info` Failures

- **500 error**: The `agents` promise rejected (lazy agent loading failed). Check the agents factory function.
- **404 error**: Wrong basePath or the runtime is not mounted at the expected URL.
- **CORS error**: The preflight for `/info` failed. See CORS section above.

## Custom Headers and Authentication

### Passing Headers from Client to Runtime

```tsx
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  headers={{ Authorization: `Bearer ${token}` }}
/>
```

Headers are sent with every request to the runtime, including `/info`, `/agent/:id/run`, etc.

### Accessing Headers in Middleware

```ts
const runtime = new CopilotRuntime({
  agents: { /* ... */ },
  beforeRequestMiddleware: async ({ request }) => {
    const auth = request.headers.get("Authorization");
    // Validate auth, modify request, or throw to reject
    return request;
  },
});
```

### Header Forwarding to Agents

Headers from the client are available in the runtime middleware but are NOT automatically forwarded to remote agents (A2A). This is a known limitation (issue #3170 and #3425). To forward headers, use middleware to inject them into the agent configuration.
