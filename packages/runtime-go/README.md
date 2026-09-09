# CopilotKit Intelligence runtime for Go

Use Go 1.22 or newer. Point your application at the module in your local
CopilotKit checkout:

```sh
go mod edit -replace=github.com/CopilotKit/CopilotKit/packages/runtime-go=/path/to/CopilotKit/packages/runtime-go
go get github.com/CopilotKit/CopilotKit/packages/runtime-go
```

Replace `/path/to/CopilotKit` with your checkout path. Run these commands from
an application directory with a `go.mod` file.

Import it as `copilotkit`:

```go
import copilotkit "github.com/CopilotKit/CopilotKit/packages/runtime-go"
```

The runtime implements `http.Handler`. It connects native Go agents and AG-UI
HTTP agents to CopilotKit Intelligence. An Intelligence project API key and
authenticated application identity are required.

## Start a server

1. Set `CPK_INTELLIGENCE_API_KEY` to your project key.
2. Set `APP_USER` and `APP_PASSWORD` for the local example.
3. Save this program as `main.go`.
4. Run `go run .`.

This example binds to loopback and uses HTTP Basic authentication for one app
user. For deployment, use HTTPS and replace `IdentifyUser` with your session
verifier. The project key stays on the server.

```go
package main

import (
	"context"
	"crypto/subtle"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	copilotkit "github.com/CopilotKit/CopilotKit/packages/runtime-go"
)

type helloAgent struct{}

func (helloAgent) Description() string { return "Returns a greeting from Go" }

func (helloAgent) Run(ctx context.Context, input map[string]any, emit func(copilotkit.Event) error) error {
	runID, _ := input["runId"].(string)
	messageID := "hello-" + runID
	events := []copilotkit.Event{
		{"type": "RUN_STARTED"},
		{"type": "TEXT_MESSAGE_START", "messageId": messageID, "role": "assistant"},
		{"type": "TEXT_MESSAGE_CONTENT", "messageId": messageID, "delta": "Hello from Go."},
		{"type": "TEXT_MESSAGE_END", "messageId": messageID},
		{"type": "RUN_FINISHED"},
	}
	for _, event := range events {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := emit(event); err != nil {
			return err
		}
	}
	return nil
}

func main() {
	appUser, appPassword := os.Getenv("APP_USER"), os.Getenv("APP_PASSWORD")
	if appUser == "" || appPassword == "" {
		log.Fatal("Set APP_USER and APP_PASSWORD")
	}

	rt, err := copilotkit.New(copilotkit.Config{
		APIKey: os.Getenv("CPK_INTELLIGENCE_API_KEY"),
		IdentifyUser: func(r *http.Request) (copilotkit.User, error) {
			user, password, ok := r.BasicAuth()
			if !ok || user != appUser ||
				subtle.ConstantTimeCompare([]byte(password), []byte(appPassword)) != 1 {
				return copilotkit.User{}, errors.New("authentication required")
			}
			return copilotkit.User{ID: appUser, Name: appUser}, nil
		},
		Agents: map[string]copilotkit.Agent{"default": helloAgent{}},
		OnError: func(event copilotkit.RuntimeError) {
			log.Printf("runtime %s: %v", event.Operation, event.Err)
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	server := &http.Server{
		Addr: "127.0.0.1:3000", Handler: rt,
		ReadHeaderTimeout: 5 * time.Second,
	}
	defer server.Close()
	stop, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	serverError := make(chan error, 1)
	go func() { serverError <- server.ListenAndServe() }()

	select {
	case <-stop.Done():
	case err := <-serverError:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Printf("server: %v", err)
		}
	}

	shutdown, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelShutdown()
	if err := rt.CloseContext(shutdown); err != nil {
		log.Printf("runtime shutdown: %v", err)
	}
	if err := server.Shutdown(shutdown); err != nil {
		log.Printf("HTTP shutdown: %v", err)
	}
}
```

Point your CopilotKit frontend at `http://127.0.0.1:3000/copilotkit` and supply
the app authentication headers with its requests. The default mount is
`/copilotkit`. `BasePath` changes that prefix.

### Use an HTTP agent

Replace the agent registration with an AG-UI SSE endpoint:

```go
Agents: map[string]copilotkit.Agent{
    "default": &copilotkit.HTTPAgent{
        URL: "http://127.0.0.1:8000/agent",
        DescriptionText: "Answers customer questions",
        Headers: map[string]string{
            "Authorization": "Bearer " + os.Getenv("AGENT_API_KEY"),
        },
    },
},
```

`HTTPAgent.Client` sets the HTTP client for agent requests.
`Config.HTTPClient` sets the client for Intelligence platform requests.
Custom clients control their own timeouts and redirect policy.

## Agent and shutdown contracts

`Agent.Run` receives a `context.Context`, the AG-UI input, and an event callback.
`Event` preserves extension fields as `map[string]any`.
Agents must honor cancellation and return event callback errors.
Agents can implement the optional `DescribedAgent` interface with
`Description() string`. Discovery exposes that text to the frontend.
Agents that implement only `Run` have an empty description.
A successful run must emit `RUN_FINISHED`.
EOF without a terminal event produces `RUN_ERROR` with code `INCOMPLETE_STREAM`.

The runtime renews the thread lock during startup and execution. Lock loss
cancels the agent. Transient gateway failures replay the same event IDs without
calling the agent again. Idle gateway heartbeats run every 15 seconds.

When the gateway supports batches, the publisher sends at most 32 events per
batch and queues at most 32 more. Each event has a 4 MB limit.
A full queue blocks the event callback. Terminal events wait for the final
durable acknowledgment. Without batch support, every event waits for its
acknowledgment.

`Close()` rejects new requests, cancels runs, and allows ten seconds for shutdown.
`CloseContext(ctx)` uses your deadline and returns the context error when it expires.
An agent that ignores cancellation can outlive that deadline.

`OnError` receives the operation, execution IDs, and application error.
The callback runs synchronously and must return promptly.
Do not call `Close` from an active request or its error callback.
Callback panics do not prevent runtime cleanup.
Application logs can contain private error details, so apply your logging policy.

## Identity, memory, and deployment

`IdentifyUser` must return the signed-in app user's ID and display name.
Use your app's verified session or token. Do not trust a browser-supplied user
ID or derive ownership from the project API key.

Without `MemoryAccess`, memory requests use the platform's default policy.
The runtime sends the trusted user ID and project key, but no grant override.
Set `MemoryAccess` to restrict access. The callback receives the request and
the trusted user. For example, this
policy permits each authenticated user to read and write their own memories:

```go
MemoryAccess: func(_ *http.Request, user copilotkit.User) (copilotkit.MemoryGrant, error) {
    return copilotkit.MemoryGrant{User: "read-write", Project: "none"}, nil
},
```

Each grant accepts `none`, `read`, or `read-write`.
Both scopes set to `none` deny access.
Invalid grants fail before a platform request.
Callback errors deny access rather than falling back to the default policy.
`LearningContainer` can choose a container from trusted application context.

For self-hosted Intelligence, set these values together:

| Configuration | Value                                     |
| ------------- | ----------------------------------------- |
| `APIURL`      | Platform HTTP or HTTPS base URL           |
| `RunnerURL`   | Gateway WebSocket URL ending in `/runner` |
| `ClientURL`   | Browser WebSocket URL ending in `/client` |

The transport adds `/websocket` itself.
`AllowedOrigins` lists browser origins that receive CORS response headers.
CORS does not replace authentication.
`LockTTL` defaults to 20 seconds. `HeartbeatInterval` defaults to 15 seconds and
must be positive and shorter than `LockTTL`.

## MCP Apps and A2UI

Register MCP Apps servers with trusted server-side credentials:

```go
MCPApps: &copilotkit.MCPAppsConfig{
    Servers: []copilotkit.MCPServer{{
        Type: "http", URL: "https://mcp.example.com/mcp",
        ServerID: "tools", AgentID: "default",
        Headers: map[string]string{
            "Authorization": "Bearer " + os.Getenv("MCP_API_KEY"),
        },
    }},
},
```

MCP Apps uses Streamable HTTP. Server registrations control endpoint URLs,
headers, and optional agent scope. Credentials do not enter browser activity
events. The runtime discovers UI tools, handles calls, and closes each session.
Iframe requests can call tools, read resources, send message notifications, or
ping configured servers. They bypass the agent.

Gateway replay preserves runtime events. It does not undo or deduplicate
external MCP side effects. Design side-effecting tools for safe retries.

Enable A2UI tool injection with your component catalog:

```go
A2UI: &copilotkit.A2UIConfig{
    InjectA2UITool: true,
    Schema: catalog,
    Agents: []string{"default"},
},
```

`InjectA2UITool` accepts `true` for `render_a2ui` or a custom tool-name string.
`Enabled` accepts a boolean pointer. An explicit `false` overrides frontend
catalog defaults.

Component arrays become visible after structural and catalog validation.
Data items stream progressively. User actions become tool history.
Validation covers IDs, roots, required properties, child references, and cycles.
Use your agent or model adapter for additional JSON Schema validation and
generation retries.

## Telemetry

Telemetry excludes prompts, app-user IDs, project keys, and raw upstream errors.
`TelemetrySampleRate` defaults to `0.05`.
`COPILOTKIT_TELEMETRY_SAMPLE_RATE` overrides that value.

`TelemetryID`, then `CPK_TELEMETRY_ID`, selects a header-only identity.
A standalone identity does not bypass sampling.
Without that identity, `LicenseToken` can supply a legacy `telemetry_id` claim.
`COPILOTKIT_LICENSE_TOKEN` supplies a fallback for a blank configured token.
A valid claim selects every event and sets `telemetry_identified` to `true`.
Only the extracted identity leaves the runtime. The claim grants no access and
does not verify a license signature.

Set `TelemetryDisabled: true` to disable telemetry.
The environment variables `DO_NOT_TRACK` and `COPILOTKIT_TELEMETRY_DISABLED`
also disable it when set to `true` or `1`.
Opt-out takes precedence over license attribution.

`TelemetryURL`, then `COPILOTKIT_TELEMETRY_URL`, selects the sink.
The default is `https://telemetry.copilotkit.ai/ingest`.
Sink requests time out after three seconds and never follow redirects.
Each runtime has one exporter worker and a 128-event queue.
Queue overflow drops analytics without blocking agent runs.
`FlushTelemetry(ctx)` waits for queued events. Shutdown allows at most three
seconds for analytics within the runtime's shutdown deadline.
