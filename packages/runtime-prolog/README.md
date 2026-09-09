# CopilotKit runtime for Prolog

Build and install the SWI-Prolog pack from this repository:

```sh
pnpm nx run runtime-prolog:pack
swipl -g "pack_install('packages/runtime-prolog/dist/copilotkit_runtime-0.1.0.tgz',[interactive(false)]),halt"
```

The runtime requires SWI-Prolog 9.0 or later, with its HTTP, JSON, WebSocket, SSL, and PCRE libraries.
Ubuntu provides these libraries through `swi-prolog-nox`.
The installed runtime uses native Prolog threads and sockets.
Node and pnpm serve only the repository build and test tools.

## Start a native agent

1. Set `CPK_INTELLIGENCE_API_KEY` to your Intelligence project key.
2. Set `DEMO_AUTH_TOKEN` and `DEMO_USER_ID` for the single-user example.
3. Run the example:

   ```sh
   swipl -q -s packages/runtime-prolog/examples/server.pl
   ```

4. Point your CopilotKit frontend at `http://localhost:4000/copilotkit`.
5. Supply `Authorization: Bearer <DEMO_AUTH_TOKEN>` with frontend requests.

The [complete example](examples/server.pl) emits an answer from a native Prolog predicate.
The demo token identifies one application user.
A deployed host must replace `identify/2` with its own authenticated session lookup.
Runtime users are customer application users, not Intelligence dashboard users.

A runtime accepts a dict of named agents:

```prolog
:- use_module(library(copilotkit_runtime)).

start(Runtime) :-
    getenv('CPK_INTELLIGENCE_API_KEY',Raw),
    atom_string(Raw,Key),
    runtime_create(_{
        api_key:Key,
        identify_user:my_app:identify,
        agents:_{
            default:_{
                url:"http://localhost:8000/agent",
                description:"My AG-UI agent"
            },
            rules:_{
                run:my_app:rules_agent,
                description:"Native rules agent"
            }
        }
    },Runtime),
    runtime_listen(Runtime,[port(4000)],_).
```

An HTTP agent uses AG-UI over SSE.
Its optional `headers` dict supplies trusted server credentials.
A native agent implements `rules_agent(+Input, :Emit)` and calls `Emit` once per AG-UI event dict.
Each call must keep mutable state local to that run.
The agent must emit `RUN_FINISHED` or `RUN_ERROR` before it returns.

## Host callbacks and configuration

Callbacks in configuration dicts must include their module, such as `my_app:identify`.
Callback failure or an invalid result rejects the request.
Public errors exclude upstream bodies and credentials.

| Configuration                         | Contract                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `identify_user`                       | Required predicate `(+Request, -User)`. Returns `_{id:"customer-user-id", name:"Optional name"}`.                  |
| `agents`                              | Dict keyed by agent name. Each agent has `url` or a native `run` predicate.                                        |
| `base_path`                           | Runtime route prefix. The default is `/copilotkit`.                                                                |
| `api_url`, `runner_url`, `client_url` | Intelligence HTTP, runner WebSocket, and client WebSocket endpoints. Defaults use the hosted Intelligence service. |
| `cors_origins`                        | Exact allowed browser origins. The default is an empty list.                                                       |
| `memory_access`                       | Optional predicate `(+User, +Request, -Grant)`. Returns user and project permissions.                              |
| `learning_container`                  | Optional predicate `(+User, +Input, -ContainerId)`. Selects a Learning Container for new threads.                  |
| `a2ui`                                | `true` or a dict with `enabled`, `agents`, `schema`, `injectA2UITool`, and `defaultCatalogId`.                     |
| `mcp_apps`                            | Dict with a `servers` list of trusted Streamable HTTP server configurations.                                       |
| `telemetry`                           | Dict with `disabled`, `sample_rate`, `telemetry_id`, `license_token`, and `url`.                                   |

`runtime_handler(+Runtime, +Request)` also works inside an existing SWI-Prolog HTTP server.
`runtime_dispatch/8` accepts an already-decoded method, route segments, query, JSON body, and native request.
The identity callback still receives the native request.
`runtime_close/1` stops active agents, releases locks, drains telemetry, and stops listeners created by `runtime_listen/3`.

## Memory access

A memory policy returns both scopes:

```prolog
memory_access(_User, _Request, _{user:"read-write", project:"read"}).
```

Each scope accepts `"none"`, `"read"`, or `"read-write"`.
An omitted policy delegates authorization to Intelligence without a grant header.
A `null` result or two `"none"` values deny access before the runtime contacts Intelligence.
The runtime sends the authenticated user through its trusted identity header.
Browser headers and JSON cannot replace this identity or grant.

## A2UI and MCP Apps

A2UI configuration can limit UI generation to named agents:

```prolog
a2ui:_{
    enabled:true,
    agents:["default"],
    injectA2UITool:"render_a2ui",
    schema:_{components:_{
        'Text':_{required:["text"]}
    }}
}
```

The middleware checks component IDs, roots, catalog requirements, child references, and cycles before it emits a surface.
It preserves complete component trees across progressive data updates.
It also preserves action history and emits render results.
Model adapters own generation retries.

MCP Apps uses trusted Streamable HTTP configuration:

```prolog
mcp_apps:_{servers:[_{
    type:"http",
    url:"https://mcp.example.com/mcp",
    serverId:"cards",
    agentId:"default",
    headers:_{'Authorization':"Bearer server-owned-token"}
}]}
```

The runtime advertises MCP tools that supply UI resource metadata.
It executes calls, persists tool results and activities, and closes each MCP session.
Iframe requests can use `tools/call`, `resources/read`, `notifications/message`, and `ping`.
The runtime selects the server from trusted configuration before it opens a connection.
Browser URLs and credentials cannot override that configuration.

## Inspector metadata

`GET /copilotkit/inspector-metadata` returns sanitized V1 project display metadata.
The runtime uses its project key and sends `Cache-Control: no-store, private`.
An unsupported response or an unavailable provider returns an empty 204 response.
Display metadata never grants access to threads or memories.

## Durable runs and telemetry

The runtime acquires an Intelligence lock and joins Phoenix before it returns run credentials.
It saves canonical input before it starts the agent.
Every event carries a stable ID and sequence number.
A reconnect resends unacknowledged events without starting the agent again.
Completion telemetry follows the final durability acknowledgment.

Each run has a queue of 32 agent events and 64 gateway replies.
The runtime renews locks and sends gateway heartbeats every 15 seconds.
Gateway delivery allows four attempts with bounded delays.
The default lock TTL is 20 seconds.

Telemetry exports canonical lifecycle events through a queue of 256 entries.
It excludes prompts, application identities, run IDs, thread IDs, and raw errors.
The default sample rate is 0.05.
`DO_NOT_TRACK` and `COPILOTKIT_TELEMETRY_DISABLED` accept `true` or `1` to disable export.
`COPILOTKIT_TELEMETRY_SAMPLE_RATE` overrides the configured rate.
`CPK_TELEMETRY_ID` provides header-only attribution.
A legacy license claim can select analytics attribution and sampling, but never authorizes a runtime request.

## Validation

Run package tests and archive installation:

```sh
pnpm nx run-many -t test,test-native,lint,build,pack -p runtime-prolog --parallel=1
```

Run the unchanged shared suite:

```sh
pnpm nx run-many -t build -p @copilotkit/core --parallel=1
pnpm nx run runtime-conformance:conformance -- -- swipl -q -s packages/runtime-prolog/examples/conformance.pl
```

The shared suite uses AIMock and real loopback HTTP and Phoenix sockets.
The frontend case runs public CopilotKit Core in Node.
It does not test browser rendering or a live hosted deployment.
