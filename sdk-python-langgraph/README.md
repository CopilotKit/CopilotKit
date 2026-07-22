# CopilotKit Intelligence for LangGraph Python

`copilotkit-intelligence-langgraph` projects verified CopilotKit Intelligence
Registry skills into LangGraph through native agent middleware.

## Installation

This package supports Python 3.10 or newer,
`langgraph>=1.2.2,<2.0.0`, `langchain>=1.3.2,<2.0.0`, and
`copilotkit>=0.1.95,<1.0.0`.

## Native registration

The adapter returns native LangGraph `AgentMiddleware`; it never constructs or
wraps an agent. Register it with `langchain.agents.create_agent`:

```python
from langchain.agents import create_agent
from copilotkit_intelligence_langgraph import createSkillRegistryMiddleware

middleware = createSkillRegistryMiddleware(copilotkit_client, learning_container_id)
agent = create_agent(model, middleware=[middleware])
```

`create_skill_registry_middleware is the Python spelling of the normative createSkillRegistryMiddleware API.`
The two names reference the same factory object.

Before every native model call, the middleware loads one complete verified set
and appends its deterministic ordered instructions to a copied model request.
It preserves the caller's messages, tools, state, runtime, model settings, and
system-message metadata. The adapter never executes skill scripts.

## Lifecycle and preload

Use `await middleware.preload()` for an explicit fresh preload,
`await middleware.preload_cached()` for an explicitly offline preload, or
`await middleware.load()` at request time. `middleware.status`,
`middleware.ready`, and `await middleware.wait_until_ready(timeout)` expose
readiness. A cold native model call waits for one complete verified set and
does not call the model handler early.

## Fresh and cached data

Fresh preload and request-time load delegate only to the generic SDK's
`client.skills.get(...)`; cached preload delegates only to
`client.skills.get_cached(...)`. Snapshots report `fresh` or `cached` source.
Request-time loads are throttled for 30 seconds and share one in-flight call.
A transient refresh publishes `stale` and rejects the model call: there is no
implicit stale-data fallback.

## Limits and scripts

The complete set is rejected above 128 skills, above 262144 bytes for one
`SKILL.md`, or above 1048576 aggregate bytes. Instructions must be strict
UTF-8. Any failure rejects the full set. Manifest files with a `script` role or
a normalized path beginning with `scripts/` are denied before content is read.

## Telemetry

Events are `load.started`, `load.throttled`, `load.singleflight_joined`,
`status.changed`, `load.succeeded`, and `load.failed`. Metadata is restricted to
framework/adapter version, source/freshness, status/outcome/reason, latency,
skill count, Registry revision, and canonical error code/category/retryability,
request ID, and trace ID. Tokens, container IDs, paths, and instruction content
are forbidden. A telemetry sink exception is propagated explicitly; every
caller joined to that load receives the same adapter failure instance.
Failures from the `load.singleflight_joined` event are folded into the shared
operation before publication, so both initiating and joining callers see that
same terminal error identity.

## Errors

Auth, permission, HTTP 401/403/404/410, archived-container,
project-mismatch, container-not-found, and Registry-unrecoverable errors deny
the set and preserve the generic SDK's canonical metadata. Transient or
integrity refresh failures become `LEARNING_REGISTRY_STALE`. Adapter validation
errors cover count, individual and aggregate byte limits, strict UTF-8,
disabled scripts, and unsupported legacy SDK projections. A denied or stale
snapshot refuses the native model handler.

## Closing

`await middleware.aclose()` is idempotent and changes status to `closed`.
Closing does not cancel an already running native invocation, but every future
fresh, cached, or request-time load rejects with `LEARNING_REGISTRY_CLOSED`.
An in-flight load may finish for its existing caller, but close suppresses every
later ready/stale/denied transition and success/failure telemetry emission.

## Compatibility

The exact supported ranges are `langgraph>=1.2.2,<2.0.0`,
`langchain>=1.3.2,<2.0.0`, and `copilotkit>=0.1.95,<1.0.0`. The public
`langchain.agents.middleware.AgentMiddleware` sync `wrap_model_call` and async
`awrap_model_call` hooks, `ModelRequest.override(...)`, and native
`create_agent(..., middleware=[middleware])` registration are tested at the
minimum LangGraph 1.2.2/LangChain 1.3.2 pair and the newest compatible pair.

## Ownership and release

The Intelligence/Learning team owns this package. It is independently
versioned, tagged, and published, and its release does not require or trigger a
release of another adapter or the generic SDK.
