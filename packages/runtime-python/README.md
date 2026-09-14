# CopilotKit Intelligence Runtime for Python

Host Python agents and the CopilotKit Intelligence API in an ASGI application.
The package requires Python 3.11 or later and an Intelligence project API key.

## Use Intelligence without a server

The `copilotkit_intelligence` SDK is separate from the `copilotkit_runtime` ASGI application.
Both imports ship in this package. The SDK does not import ASGI, start an agent, or mount routes.
Use it from a script or worker to manage threads, recall memories, and record annotations.

```python
import asyncio
import os

from copilotkit_intelligence import Intelligence


async def main():
    async with Intelligence(api_key=os.environ["CPK_INTELLIGENCE_API_KEY"]) as intelligence:
        thread = await intelligence.get_or_create_thread(
            thread_id="9dcc02ea-695d-4635-8efc-649c1b94ab90",
            user_id="customer-42",
            agent_id="support",
            learning_container_id="support-quality",
        )
        memories = await intelligence.recall_memories(
            user_id="customer-42",
            query="support preferences",
            limit=5,
        )
        print(thread["thread"]["id"], memories["memories"])


asyncio.run(main())
```

`learning_container_id` assigns a new thread to an existing Learning Container.
Intelligence owns that binding and rejects attempts to move a bound thread.

The SDK also provides `list_threads`, `get_thread`, `create_thread`, `update_thread`, and `archive_thread`.
`get_thread_messages`, `get_thread_events`, and `get_thread_state` read persisted thread data.
`delete_thread` permanently deletes a thread and its history.

Thread and history methods return dictionaries with public `TypedDict` annotations.
`ThreadSummary` describes metadata. `ThreadMessagesResponse` and `ThreadEventsResponse` describe persisted history.
`ThreadStateResponse` distinguishes a snapshot, no snapshot, and a snapshot decode error through the `kind` field.
`AnnotateResponse` includes the annotation ID and duplicate marker. Structured message content and custom event fields retain their JSON values.

Memory methods include `list_memories`, `create_memory`, `update_memory`, `remove_memory`, and `recall_memories`.
Results use public `TypedDict` annotations: `MemorySummary`, `ListMemoriesResponse`, `RecallMemoriesResponse`, and `SaveMemoryResponse`.
Your editor can show Memory fields, recall scores, and save markers. Results remain dictionaries with the original JSON field names and extension values.
Pass a `MemoryGrant(user="read-write", project="read")` as `memory_grant` to apply explicit limits.
Without a grant, Intelligence applies its policy. Every Memory call requires the bare application user ID.

`annotate` records an annotation. Reuse `client_event_id` when retrying the same annotation.
The SDK raises `IntelligenceError` with an HTTP status but no private response body.
Requests have a 30-second timeout by default. The SDK does not retry writes or follow redirects.

Pass the same client to `IntelligenceRuntime(intelligence=intelligence, agents=agents, identify_user=identify_user)` to mount Runtime routes.
The Runtime borrows that client. Close the Runtime before leaving the SDK context.
If you supply an `httpx.AsyncClient`, you retain ownership of its pool.

## Handle thread changes

Register synchronous listeners on the SDK:

```python
unsubscribe = intelligence.on_thread_created(lambda thread: print(thread["id"]))
```

`on_thread_created` receives the canonical thread after creation.
`on_thread_updated` receives the thread after an update or archive.
`on_thread_deleted` receives `threadId`, `userId`, and `agentId` after deletion.
Each registration returns an unsubscribe function. Call it to stop that listener.

Listeners receive changes from direct SDK calls and from a Runtime that shares the SDK.
Failed requests and concurrent-create conflicts emit no success event.
Listener exceptions do not stop other listeners or replace a successful platform response.
The SDK reports these exceptions through the standard Python logging module.

## Read Inspector metadata

Read project display metadata from application code:

```python
from copilotkit_intelligence import InspectorMetadata

metadata: InspectorMetadata | None = await intelligence.get_inspector_metadata()
if metadata is not None and "plan" in metadata:
    print(metadata["plan"]["label"])
```

The typed result contains supported identity, plan, license, action, and usage fields.
Each module is optional. The SDK removes unknown fields and unsafe action URLs.
Metadata describes the project. It does not grant access to a feature or resource.

The request uses the server API key and a five-second deadline, including the response body.
A shorter `request_timeout` also applies. Deadline expiry raises `TimeoutError`.
A 204, 404, or unsupported schema returns `None`.
Other provider errors raise `IntelligenceError` with the HTTP status. Invalid JSON uses status 502.

The Runtime exposes the same data at `GET /copilotkit/inspector-metadata`.
Like `/info`, this display endpoint does not require an application-user identity.
It never forwards browser credentials to Intelligence.
Responses use `Cache-Control: no-store, private`. Provider errors produce an empty 204 response.
The `/info` response advertises this route through `inspectorMetadata: true`.

## Read Runtime entitlements

Read the Runtime grant from a script, worker, or application:

```python
from copilotkit_intelligence import RuntimeEntitlementResponse

result: RuntimeEntitlementResponse = await intelligence.get_runtime_entitlements()
if result["status"] == "ready":
    print(result["entitlement"]["active"])
else:
    print(result["error"]["code"])
```

A ready result contains the grant, features, and limits. Its `active` value determines Runtime access.
Other results have status `degraded`, `misconfigured`, or `unavailable` and contain a structured error.
The SDK accepts both current responses and legacy flat responses.

Concurrent calls share one HTTP request. Each caller receives a separate copy.
Active grants remain in the cache for 30 seconds. Other results and request errors remain for five seconds.
After expiry, the SDK requests a fresh result. A failed request does not return an expired grant.

The request deadline is 1.5 seconds, including the response body.
A shorter `request_timeout` also applies.
`RuntimeEntitlementError` extends `IntelligenceError` with a `retryable` flag.
Errors retain the HTTP status and retry guidance without transport messages or response bodies.
Invalid responses use status 502 with `retryable=False`. Timeouts use status 504 with `retryable=True`.

Caller cancellation does not interrupt other callers that await the same request.
When the last caller cancels, the SDK cancels the HTTP request.
SDK shutdown also cancels an active entitlement request and preserves a supplied HTTP client.

The Runtime uses this SDK method and cache for `/info`.
Configuration errors produce a non-retryable `misconfigured` result.
Retryable failures produce an `unavailable` result and an `unknown` compatibility license status.

## Install and start

1. From the repository root, install the package and an ASGI server:

   ```sh
   pip install ./packages/runtime-python
   pip install uvicorn
   ```

2. Set `CPK_INTELLIGENCE_API_KEY`, `APP_AUTH_TOKEN`, and `APP_USER_ID` in your server environment.

   This example binds one private application token to one application user.
   `APP_AUTH_TOKEN` must differ from the Intelligence API key.

3. Save this application as `app.py`:

   ```python
   import hmac
   import os
   from collections.abc import AsyncIterator
   from typing import Any

   from starlette.requests import Request

   from copilotkit_runtime import IntelligenceRuntime, RuntimeConfig, User


   class GreetingAgent:
       description = "Returns a greeting"

       async def run(self, input: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
           yield {"type": "TEXT_MESSAGE_START", "messageId": "greeting", "role": "assistant"}
           yield {"type": "TEXT_MESSAGE_CONTENT", "messageId": "greeting", "delta": "Hello"}
           yield {"type": "TEXT_MESSAGE_END", "messageId": "greeting"}
           yield {"type": "RUN_FINISHED"}


   async def identify_user(request: Request) -> User | None:
       expected = f"Bearer {os.environ['APP_AUTH_TOKEN']}".encode()
       supplied = request.headers.get("authorization", "").encode()
       if not hmac.compare_digest(supplied, expected):
           return None
       return User(id=os.environ["APP_USER_ID"], name="Application user")


   app = IntelligenceRuntime(
       RuntimeConfig(api_key=os.environ["CPK_INTELLIGENCE_API_KEY"]),
       agents={"default": GreetingAgent()},
       identify_user=identify_user,
   )
   ```

4. Start the application:

   ```sh
   python -m uvicorn app:app --port 8000
   ```

The runtime API is at `http://localhost:8000/copilotkit`.
`/copilotkit/info` describes the agents. The API also serves agent run/connect/stop routes, threads, memories, and annotations.
Authenticated requests use `Authorization: Bearer <APP_AUTH_TOKEN>` in this example.

## Identify your application users

Replace the example token lookup with your application's session or token verification.
Return `User(id=..., name=...)` for the verified application user. Return `None` to deny access.
The callback can be synchronous or asynchronous.

The user ID identifies your application user, not an API-key owner or a control-plane user.
The runtime uses this identity for scoped platform requests. Stop requests recheck current ownership and use the platform's canonical thread ID.

Keep the Intelligence API key on the server. Do not accept a user ID from an unverified browser header.

## Write an async agent

An agent has a `description` attribute and a `run(input)` method that returns an async iterator of AG-UI event dictionaries.
The runtime adds `RUN_STARTED` and stamps canonical thread and run IDs on each event.
Keep per-run mutable state inside `run`. Release open resources in `finally` blocks and allow cancellation to propagate.

Every agent must emit `RUN_FINISHED` or `RUN_ERROR`.
A missing terminal event produces `INCOMPLETE_STREAM`, including an HTTP stream that ends with EOF or `[DONE]`.
The runtime closes unfinished text and tool streams and adds missing tool results. An authorized stop ends with `RUN_FINISHED`.

For an HTTP AG-UI agent, replace `GreetingAgent()` with an `HttpAgent` instance:

```python
from copilotkit_runtime import HttpAgent

agent = HttpAgent(
    "http://localhost:8001/agent",
    headers={"Authorization": "Bearer " + os.environ["AGENT_TOKEN"]},
    timeout=120,
)
```

`HttpAgent` uses server-owned headers. It does not forward browser authentication headers.

## Configure the runtime and its lifecycle

`RuntimeConfig` contains the Intelligence endpoints, route prefix, CORS configuration, and transport limits:

```python
config = RuntimeConfig(
    api_key=os.environ["CPK_INTELLIGENCE_API_KEY"],
    base_path="/copilotkit",
    allowed_origins=("http://localhost:3000",),
    request_timeout=30,
    ack_timeout=10,
    max_delivery_attempts=5,
    lock_ttl_seconds=60,
    lock_heartbeat_seconds=20,
    shutdown_timeout=15,
)
```

`api_url`, `runner_url`, and `client_url` select the HTTP API and the two WebSocket endpoints.
The defaults connect to the managed Intelligence service.

The runtime acquires a lock and joins the authenticated ingestion channel before it returns browser credentials.
Lock renewal starts before history loading and channel join. A lost lease cancels startup or agent work.

The producer queue holds at most 32 events. Negotiated batches contain at most 32 events.
Delivery retries preserve event IDs, sequences, and payloads. A permanent gateway rejection stops delivery.
The active batch must receive its ACK before normal lock cleanup.

The ASGI lifespan closes the runtime automatically. If your host manages lifespan separately, call `await app.aclose()` during shutdown.
Shutdown cancels pending startups and gives active runs `shutdown_timeout` seconds for cleanup. It then aborts their transports.
Application agents must cooperate with cancellation. An abrupt process exit can lose in-process events that lack an ACK.

## Set memory and learning policies

Pass a trusted memory callback to `IntelligenceRuntime(memory_policy=...)`:

```python
def memory_policy(user: User, request: Request) -> dict[str, str]:
    return {"user": "read-write", "project": "read"}
```

Each grant value is `none`, `read`, or `read-write`.
`None` or a grant with both values set to `none` denies access before a platform request.
The runtime rejects invalid grants and forwards valid server-owned grants to Intelligence.
Without a callback, Intelligence applies its default memory policy.

`learning_container(user, agent_id, input)` returns an optional Learning Container ID.
The runtime supplies that ID for thread creation and lock acquisition.
Both callbacks can return a value directly or through an awaitable.

## Use MCP Apps and A2UI

Pass the UI configuration to the runtime constructor:

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

MCP Apps requires a Streamable HTTP server. The runtime uses the official Python MCP SDK and closes each session after its operation.
It discovers UI-enabled tools, adds their schemas to the agent input, and runs unresolved calls before `RUN_FINISHED`.
It publishes tool results and `mcp-apps` activity snapshots.

Browser reentry uses `forwardedProps.__proxiedMCPRequest` without another agent call.
The proxy permits configured servers and four methods: `tools/call`, `resources/read`, `notifications/message`, and `ping`.
Browser input cannot replace server authentication headers.

A2UI adds schema context and rendering tools. `inject_tool` accepts `True`, `False`, or a custom tool name.
`agents` limits A2UI to named agents. `enabled=False` disables it for every agent.
Action history comes from `forwardedProps.a2uiAction.userAction`.

A2UI validates complete component arrays before publication, then publishes cumulative data snapshots as array items arrive.
Validation covers IDs, component types, roots, catalog membership, required properties, references, and cycles.
The `schema` configuration describes A2UI components, not arbitrary JSON Schema validation.
Build, retry, error, and painted surface updates share one activity ID. The agent controls model retries.

## Configure analytics and error reporting

Pass a telemetry instance to `IntelligenceRuntime(telemetry=...)`:

```python
from copilotkit_runtime import Telemetry

telemetry = Telemetry(sample_rate=0.05, telemetry_id="my-application")
```

Analytics use `https://telemetry.copilotkit.ai/ingest`. `Telemetry(url=...)` changes the endpoint.
`COPILOTKIT_TELEMETRY_URL` overrides the endpoint. The exporter does not follow redirects and has a three-second request deadline.

The default sample rate is `0.05`. `COPILOTKIT_TELEMETRY_SAMPLE_RATE` overrides `sample_rate`.
Rates must be finite and within `[0, 1]`.
Events include the sample rate, adjustment factor, weight, emitter, transport, and an integer Unix timestamp.
Analytics contain no prompts, user IDs, thread IDs, API keys, or raw errors.

`telemetry_id` supplies a standalone identity. `CPK_TELEMETRY_ID` supplies its fallback.
Identities accept 1–128 ASCII letters, digits, underscores, or hyphens, with optional spaces and tabs at each end.
The identity travels only in `X-CopilotKit-Telemetry-Id`. A standalone identity does not bypass sampling.

`Telemetry(license_token=...)` accepts a legacy analytics token. `COPILOTKIT_LICENSE_TOKEN` supplies the fallback for a blank configured token.
Without a standalone identity, a valid `telemetry_id` claim selects every event and sets `telemetry_identified` to true.
The exporter sends only the extracted identity. This claim does not verify a license signature or grant access.

`RuntimeConfig(telemetry_enabled=False)` disables default analytics. `Telemetry(enabled=False)` disables an explicit instance.
`DO_NOT_TRACK` or `COPILOTKIT_TELEMETRY_DISABLED` disables analytics with a value of `true` or `1`.
Opt-out takes precedence over license attribution.

The exporter holds at most 256 events and discards new events when the queue fills.
Requests do not wait for analytics delivery. `telemetry.stats` reports queue depth, sends, errors, discarded events, and sampling exclusions.
`await telemetry.flush()` waits at most three seconds. Runtime shutdown gives the exporter a separate bounded flush period.

`Telemetry(sink=async_callback)` supplies a custom sink with the same deadline and event contract.
`IntelligenceRuntime(on_error=async_callback)` supplies a separate application error handler.
The handler receives an exception and a fixed phase name. It has a three-second deadline, and its errors do not fail requests.
Both callbacks must support cancellation and must not block the event loop.

## Develop in this repository

Run package checks from the repository root:

```sh
NX_DAEMON=false pnpm nx run-many -t test,lint,typecheck,build -p runtime-python
```

Run the shared integration cases:

```sh
NX_DAEMON=false pnpm nx run runtime-conformance:conformance -- -- uv run --project packages/runtime-python python packages/runtime-python/examples/conformance.py
```
