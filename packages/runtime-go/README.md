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

Call `Close` during host shutdown. It cancels agent runs and waits for background
work. Telemetry uses fixed event properties and never includes prompts, user IDs,
project keys, or raw upstream error text. Set `TelemetryDisabled` or the standard
`DO_NOT_TRACK`/`COPILOTKIT_TELEMETRY_DISABLED` environment flags to opt out.

## Current validation limits

The initial implementation covers run/connect, HTTP agents, threads, memory
forwarding, annotations, lock renewal, durable event replay and telemetry.
MCP Apps, A2UI middleware, full AG-UI abrupt-stream finalization, entitlement
cache/gating, and operational trace export remain pending. Unknown AG-UI event
fields pass through, which alone does not establish MCP Apps or A2UI support.

Run `pnpm nx run-many -t test,build,lint -p runtime-go` from the repository root.
The test target uses the Go race detector. On macOS with Go 1.22 and newer system
linkers, use `GOFLAGS=-ldflags=-linkmode=external` and a working developer toolchain.
