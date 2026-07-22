# CopilotKit Intelligence for Google ADK

`copilotkit-intelligence-adk` projects verified CopilotKit Intelligence Registry
skills into Google ADK through `SkillRegistry` and `SkillToolset`.

## Installation

This package supports Python 3.10 or newer, `google-adk>=2.0.0,<3.0.0`, and
`copilotkit>=0.1.95,<1.0.0`.

## Native registration

The adapter registers a native Google ADK toolset; it does not construct or wrap
an agent.

```python
from copilotkit_intelligence_adk import SkillRegistry, SkillToolset
from google.adk.agents import LlmAgent

registry = SkillRegistry(copilotkit_client, learning_container_id)
agent = LlmAgent(name="skill_agent", tools=[SkillToolset(registry)])
```

Each tool invocation returns the verified instruction text and its immutable
Registry identity metadata. The adapter never executes skill scripts.

## Lifecycle and preload

Use `await registry.preload()` for an explicit fresh preload,
`await registry.preload_cached()` for an explicitly offline preload, or
`await registry.load()` at request time. `registry.status`, `registry.ready`,
and `await registry.wait_until_ready(timeout)` expose readiness. A cold registry
fails closed until one complete verified set has loaded.

## Fresh and cached data

Fresh preload and request-time load delegate only to the generic SDK's
`client.skills.get(...)`; cached preload delegates only to
`client.skills.get_cached(...)`. Snapshots report `fresh` or `cached` source.
Request-time loads are throttled for 30 seconds and share one in-flight call.
A transient refresh publishes `stale` and raises its canonical error: there is
no implicit stale-data fallback.

## Limits and scripts

The complete set is rejected above 128 skills, above 262144 bytes for one
`SKILL.md`, or above 1048576 aggregate bytes. Instructions must be strict UTF-8.
Any failure rejects the full set. Manifest files with a `script` role or a
normalized path beginning with `scripts/` are denied before content is read.

## Telemetry

Events are `load.started`, `load.throttled`, `load.singleflight_joined`,
`status.changed`, `load.succeeded`, and `load.failed`. Metadata is restricted to
framework/adapter version, source/freshness, status/outcome/reason, latency,
skill count, Registry revision, and canonical error code/category/retryability,
request ID, and trace ID. Tokens, container IDs, paths, and instruction content
are forbidden. A telemetry sink exception is propagated explicitly; every
caller joined to that load receives the same adapter failure instance.

## Errors

Auth, permission, HTTP 401/403/404/410, archived-container,
project-mismatch, container-not-found, and Registry-unrecoverable errors deny
the set and preserve the generic SDK's canonical metadata. Transient or
integrity refresh failures become `LEARNING_REGISTRY_STALE`. Adapter validation
errors cover count, individual and aggregate byte limits, strict UTF-8, disabled
scripts, and unsupported legacy SDK projections.

## Closing

`await registry.aclose()` is idempotent and changes status to `closed`. Closing
does not cancel an already running native invocation, but every future fresh,
cached, or request-time load rejects with `LEARNING_REGISTRY_CLOSED`.

## Compatibility

The exact supported ranges are `google-adk>=2.0.0,<3.0.0` and
`copilotkit>=0.1.95,<1.0.0`. The public
`google.adk.tools.base_toolset.BaseToolset` hook and its async
`get_tools(self, readonly_context=None)` method were verified through
`LlmAgent(..., tools=[toolset])` at the minimum Google ADK 2.0.0 and latest
compatible Google ADK 2.5.0.

## Ownership and release

The Intelligence/Learning team owns this package. It is independently
versioned, tagged, and published, and its release does not require or trigger a
release of another adapter.
