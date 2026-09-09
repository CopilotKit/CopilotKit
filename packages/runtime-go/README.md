# CopilotKit Intelligence runtime for Go

This package mounts the Intelligence multi-route API with `net/http`. It runs
native Go agents or remote AG-UI HTTP agents. It requires an Intelligence project
API key and a host function that resolves the signed-in application user.

```go
rt, err := runtime.New(runtime.Config{
    APIKey: os.Getenv("CPK_INTELLIGENCE_API_KEY"),
    IdentifyUser: identifyAuthenticatedUser,
    Agents: map[string]runtime.Agent{
        "default": &runtime.HTTPAgent{URL: "http://localhost:8000/agent"},
    },
})
if err != nil { log.Fatal(err) }
defer rt.Close()
http.ListenAndServe(":3000", rt)
```

Import `github.com/CopilotKit/CopilotKit/packages/runtime-go` as `runtime`.
Default mount: `/copilotkit`. Provide `APIURL`, `RunnerURL` and `ClientURL`
together for self-hosted deployments. Runner and client URLs end in `/runner`
and `/client`; the transport adds `/websocket` itself.

`Agent.Run` receives a cancellation context, the full input, and an event emitter.
Return emitter errors and honor cancellation. Each event waits for a durable
gateway acknowledgment, so agent production receives backpressure. Transient
transport failures replay identical events with stable IDs. The HTTP response
returns browser connection credentials after the gateway accepts the run.

Memory routes deny access unless `MemoryAccess` returns explicit user/project
grants. Never derive application identity or grants from unverified browser
headers. The `cmd/conformance` program uses test-only identity headers and must
not serve production traffic.

Call `Close` during host shutdown. It rejects new requests, cancels agent runs,
waits for active work, and drains analytics for at most three seconds. Each
runtime has one exporter worker and a 128-event queue; overflow drops analytics
without blocking runs. `FlushTelemetry(ctx)` waits for events already queued.
Sink requests time out after three seconds and never follow redirects.

Telemetry uses fixed event properties and never includes prompts, user IDs,
project keys, or raw upstream error text. `TelemetrySampleRate` defaults to 0.05;
`COPILOTKIT_TELEMETRY_SAMPLE_RATE` overrides it. A configured `TelemetryID`, then
`CPK_TELEMETRY_ID`, selects a header-only identity. It does not bypass sampling.
Set `TelemetryDisabled`, `DO_NOT_TRACK`, or `COPILOTKIT_TELEMETRY_DISABLED` to opt
out; environment values `true` and `1` both work. `COPILOTKIT_TELEMETRY_URL`
overrides the default sink when no explicit `TelemetryURL` is set.

Use `OnError` for application-owned identity and agent error reporting. It
receives execution identifiers and the error, independently of analytics.
Callbacks run synchronously, should return promptly, and must not call `Close`
from an active request. Callback panics do not prevent runtime cleanup.

## MCP Apps and A2UI

Set `MCPApps: &runtime.MCPAppsConfig{Servers: []runtime.MCPServer{...}}` to
register Streamable HTTP servers. Each registration has `Type: "http"`, `URL`,
optional `ServerID`, `AgentID`, and trusted `Headers`. Credentials never enter
browser activity events. The runtime negotiates MCP sessions, discovers UI tools,
executes pending calls before the run ends, and emits `mcp-apps` activities.
Iframe reentry allows only tool calls, resource reads, message notifications and
ping against configured servers. It bypasses the agent. Sessions close after use.

Set `A2UI: &runtime.A2UIConfig{InjectA2UITool: true, Schema: catalog}` to
inject `render_a2ui` and component schema context. `InjectA2UITool` also accepts
a custom tool name. `Agents` scopes middleware to named agents; `Enabled: &off`
disables it, including frontend catalog defaults. A frontend catalog can enable
tool injection unless the host explicitly opts out.

Component arrays become visible only after they close and pass structural and
catalog checks. Data items stream progressively. Each outer tool call owns one
stable activity ID. User actions become synthetic tool history. Tool results close
before the terminal run event. Component validation checks IDs, roots, catalog
membership, required properties, child references and cycles; it is not a full
JSON Schema validator. Model adapters remain responsible for generation retries.

## Current validation limits

The initial implementation covers run/connect, HTTP agents, threads, memory
forwarding, annotations, lock renewal, durable event replay and telemetry.
The shared suite covers UI discovery/execution, authenticated sessions, iframe
reentry, atomic components, progressive data, action history and agent scoping.
Legacy MCP SSE transport, OAuth credential negotiation, server-initiated MCP
requests, resumable MCP streams and adapter-owned A2UI model retries are excluded.
Entitlement cache/gating and idle Phoenix heartbeats remain pending. Gateway
durability remains separate from the MCP server's side effects. Analytics uses
the canonical CopilotKit event sink; this package does not add an OTel pipeline.

Run `pnpm nx run-many -t test,build,lint -p runtime-go` from the repository root.
The test target uses the Go race detector. On macOS with Go 1.22 and newer system
linkers, use `GOFLAGS=-ldflags=-linkmode=external` and a working developer toolchain.
