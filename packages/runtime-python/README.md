# CopilotKit Intelligence Runtime for Python

This package mounts the Intelligence runtime API in an ASGI application. It requires Python 3.11 or later and an Intelligence project API key.
It contains no Node process, GraphQL endpoint, single-route dispatcher, or open-source runner.

## Local installation

From the repository root, install the unpublished package:

```sh
pip install ./packages/runtime-python
```

## ASGI application

```python
import os

from copilotkit_runtime import HttpAgent, IntelligenceRuntime, RuntimeConfig, User


async def identify_user(request):
    # Your authentication middleware supplies this trusted principal.
    principal = request.scope.get("user")
    if principal is None or not principal.is_authenticated:
        return None
    return User(id=principal.identity, name=principal.display_name)


app = IntelligenceRuntime(
    RuntimeConfig(api_key=os.environ["CPK_INTELLIGENCE_API_KEY"]),
    agents={"default": HttpAgent("http://localhost:8001/agent")},
    identify_user=identify_user,
)
```

The application serves `/copilotkit/info`, agent run/connect/stop routes, threads, memories, and annotations.
`base_path` changes this prefix. `allowed_origins` enables CORS for selected browser origins.
The host authentication callback must return an application user, never an API-key owner or control-plane user.

## Native agents

An agent implements an async iterator with a `description` attribute:

```python
class GreetingAgent:
    description = "Returns a greeting"

    async def run(self, input):
        yield {"type": "TEXT_MESSAGE_START", "messageId": "greeting", "role": "assistant"}
        yield {"type": "TEXT_MESSAGE_CONTENT", "messageId": "greeting", "delta": "Hello"}
        yield {"type": "TEXT_MESSAGE_END", "messageId": "greeting"}
        yield {"type": "RUN_FINISHED"}
```

The runtime adds missing run lifecycle events and stamps canonical thread/run IDs on every event.
An agent must support cancellation and keep mutable execution state inside `run`.
`HttpAgent` accepts static server-owned headers. It does not forward browser headers to the agent.

## Persistence and shutdown

The runtime acquires an Intelligence lock and waits for an authenticated Phoenix join before it returns browser credentials.
It sends events in sequence and waits for each ACK before it reads the next event.
Retries preserve event IDs and payloads. A permanent gateway rejection stops delivery immediately.
The default delivery limit is five attempts. Each ACK has a ten-second timeout.

Lock renewal runs every 20 seconds with a 60-second TTL. Renewal failure cancels the agent.
The runtime releases the lock after completion, cancellation, or failure.
ASGI lifespan shutdown cancels active runs. Hosts that manage lifespan themselves must call `await app.aclose()`.
An abrupt process exit can lose unacknowledged in-process events. The runtime does not claim crash-resumable agent execution.

## Trusted policy callbacks

`memory_policy(user, request)` returns `{"user": "read-write", "project": "read"}` or another valid grant.
Each grant value is `none`, `read`, or `read-write`. The runtime forwards this server-owned grant to Intelligence.
Without a callback, Intelligence applies its default memory policy.

`learning_container(user, agent_id, input)` selects an optional Learning Container ID.
The runtime supplies that ID when it creates the thread and acquires the lock.
Both callbacks can return a value directly or through an awaitable.

## Telemetry

The library sends canonical CopilotKit analytics to `https://telemetry.copilotkit.ai/ingest`.
`Telemetry(url=...)` selects another endpoint. `COPILOTKIT_TELEMETRY_URL` overrides this configuration.
The exporter does not follow redirects. Each HTTP request has a three-second deadline.

The default sample rate is `0.05`. `Telemetry(sample_rate=...)` changes this rate.
`COPILOTKIT_TELEMETRY_SAMPLE_RATE` overrides the configured rate. Rates must be finite and within `[0, 1]`.
Each event includes its sample rate, adjustment factor, sample weight, native emitter, and transport.
Timestamps use integer Unix seconds. Analytics contain no prompts, user IDs, thread IDs, API keys, or raw errors.

`Telemetry(telemetry_id=...)` supplies a standalone identity. `CPK_TELEMETRY_ID` supplies a fallback identity.
Identities accept 1–128 ASCII letters, digits, underscores, or hyphens after spaces and tabs at each end are removed.
The identity travels only in `X-CopilotKit-Telemetry-Id`. It does not bypass sampling.

`Telemetry(license_token=...)` accepts the legacy analytics token. `COPILOTKIT_LICENSE_TOKEN` supplies a fallback when the configured token is blank.
Without a standalone identity, a valid `telemetry_id` claim selects every event and sets `telemetry_identified` to true.
The exporter sends only the extracted identity, never the token. This claim does not verify the license signature or grant access.
Analytics opt-out still takes precedence.

The exporter queues at most 256 events and discards new events when that queue fills.
Request handling does not wait for analytics delivery. `telemetry.stats` reports queue depth, sends, failures, discarded events, and sampling exclusions locally.
`await telemetry.flush()` waits at most three seconds. Runtime shutdown closes the exporter after a bounded flush.
`Telemetry(sink=async_callback)` supplies a custom asynchronous sink with the same deadline and event contract.
Custom callbacks must support cancellation and must not block the event loop.

`RuntimeConfig(telemetry_enabled=False)` disables the default telemetry instance. `Telemetry(enabled=False)` disables an explicit telemetry instance.
`DO_NOT_TRACK` and `COPILOTKIT_TELEMETRY_DISABLED` each disable telemetry when their value is `true` or `1`.

`IntelligenceRuntime(on_error=async_callback)` supplies an application-owned error handler, separate from analytics.
It receives an exception and a fixed phase name. The handler has a three-second deadline, and handler errors do not fail runtime requests.

## MCP Apps and A2UI

Add native UI middleware through the runtime constructor:

```python
from copilotkit_runtime import A2UIConfig, MCPAppsConfig, MCPServer

app = IntelligenceRuntime(
    RuntimeConfig(api_key=os.environ["CPK_INTELLIGENCE_API_KEY"]),
    agents={"default": HttpAgent("http://localhost:8001/agent")},
    identify_user=identify_user,
    a2ui=A2UIConfig(
        inject_tool=True,
        agents=("default",),
        default_catalog_id="https://example.com/my-catalog.json",
        schema={"components": {"Text": {"required": ["text"]}}},
    ),
    mcp_apps=MCPAppsConfig(
        servers=(
            MCPServer(
                url="https://example.com/mcp",
                server_id="cards",
                agent_id="default",
                headers={"Authorization": "Bearer " + os.environ["MCP_SERVER_TOKEN"]},
            ),
        )
    ),
)
```

MCP Apps uses the official Python MCP SDK for Streamable HTTP sessions.
The runtime advertises the UI extension, discovers UI-enabled tools, and injects their schemas into the agent input.
It runs unresolved tool calls before `RUN_FINISHED`, then publishes tool results and `mcp-apps` activity snapshots.
The browser can request resources or tools through `forwardedProps.__proxiedMCPRequest` without another agent call.
The proxy accepts only configured servers and four methods: `tools/call`, `resources/read`, `notifications/message`, and `ping`.
Server authentication headers never come from browser input. The runtime closes each MCP session after its operation.

A2UI adds schema context and optional rendering tools. `inject_tool` accepts `True`, `False`, or a custom tool name.
The runtime appends synthetic action history from `forwardedProps.a2uiAction.userAction`.
It validates complete component arrays before it publishes them, then publishes cumulative data snapshots as array items arrive.
Validation covers IDs, component types, roots, catalog membership, required properties, references, and cycles. It is not a general JSON Schema validator.

Building, retry, failure, and painted surfaces share one activity ID.
The agent owns model retries. The middleware reports retry state and prevents invalid component trees from the streaming path from reaching the renderer.
An explicit `enabled=False` disables A2UI for every agent. `agents` limits A2UI to the listed agent IDs.

## Verification

The runner reads stop controls even when the agent is idle. Lost lock renewal cancels agent work.
Lock renewal starts when acquisition succeeds, before history loading or channel join.
Shutdown cancels pending startups before it closes the platform client.
It retries temporary joins and planned socket restarts without starting the agent again.
Negotiated batches contain at most 32 events. Retries preserve event IDs, sequences, and payloads.
A 32-event producer queue applies backpressure. The active batch must receive its ACK before normal cleanup.
Shutdown allows `shutdown_timeout` seconds for runs to finish cleanup, then aborts their transports.
Application agents must cooperate with cancellation. Python cannot forcibly terminate arbitrary application code.
The telemetry exporter has its own bounded shutdown period.
Every agent must emit `RUN_FINISHED` or `RUN_ERROR`. Missing terminal events produce `INCOMPLETE_STREAM`, including clean HTTP EOF and `[DONE]`.
Incomplete streams close open text and tool calls and add missing tool results. Authorized stops use a clean `RUN_FINISHED`.

Run local tests, lint, type checks, and package builds from the repository root:

```sh
NX_DAEMON=false pnpm nx run-many -t test,lint,typecheck,build -p runtime-python
```

Run the shared HTTP/Phoenix/AIMock cases:

```sh
NX_DAEMON=false pnpm nx run runtime-conformance:conformance -- -- uv run --project packages/runtime-python python packages/runtime-python/examples/conformance.py
```

The conformance driver supplies test configuration only. It contains no runtime implementation.

## Current scope

Automatic memory-tool injection and the local entitlement cache are not implemented. Memory REST routes remain available.

Voice, provider-specific agents, managed Channels, automatic thread naming, and stateless suggestions are not implemented.
Legacy MCP SSE transport is not implemented. MCP Apps supports Streamable HTTP only.
