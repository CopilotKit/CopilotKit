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

The library uses the host OpenTelemetry provider for request spans, operation counters, and duration histograms.
The host owns exporter configuration, flushing, and shutdown.
`Telemetry(sink=callback)` also emits the CopilotKit event envelope for custom collection.
The sink receives lifecycle events, durations, retries, and queue depth. It receives no API keys, user IDs, or message content.

`RuntimeConfig(telemetry_enabled=False)` disables the default telemetry instance.
`DO_NOT_TRACK=1` and `COPILOTKIT_TELEMETRY_DISABLED=true` override an enabled telemetry instance.

## Verification

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

MCP Apps and A2UI middleware remain under development in this branch.
Voice, provider-specific agents, managed Channels, automatic thread naming, and stateless suggestions are not implemented.
