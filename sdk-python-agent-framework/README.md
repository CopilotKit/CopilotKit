# CopilotKit Intelligence for Microsoft Agent Framework

Use verified CopilotKit Intelligence Registry skills through Microsoft Agent Framework's native context-provider pipeline.

## Installation

Install `copilotkit-intelligence-agent-framework` on Python 3.10 or newer. Version 0.1.0 supports `copilotkit>=0.1.95,<1.0.0` and `agent-framework-core>=1.11.0,<2.0.0`.

```bash
pip install copilotkit-intelligence-agent-framework
```

## Native registration

`SkillRegistryContextProvider` is an `agent_framework.ContextProvider`, not an agent wrapper. Register it with the public `context_providers` keyword:

```python
from agent_framework import BaseAgent
from copilotkit_intelligence_agent_framework import SkillRegistryContextProvider

provider = SkillRegistryContextProvider(copilotkit_client, learning_container_id)
agent = BaseAgent(name="assistant", context_providers=[provider])
```

On every run, `before_run` loads the complete verified snapshot before context generation and appends each ordered `SKILL.md` instruction through `SessionContext.extend_instructions`; context contributed by other providers remains intact.

## Lifecycle and preload

`await provider.preload()` forces a fresh load, `await provider.preload_cached()` explicitly uses only the verified offline cache, and `await provider.load()` performs request-time loading. `provider.status`, `provider.ready`, `provider.snapshot`, and `await provider.wait_until_ready(timeout)` expose readiness. Cold, stale, denied, and closed states fail closed rather than allowing model invocation.

## Fresh and cached data

Fresh loads route through the generic SDK's networked `skills.get`; cached preload routes only through `skills.get_cached`. Snapshots report `fresh`, `cached`, or `none`. Loads are singleflight, refresh attempts are throttled for 30 seconds by default, and failures never trigger an implicit stale fallback.

## Limits and scripts

The adapter accepts at most 128 skills, 262144 bytes per `SKILL.md`, and 1048576 aggregate instruction bytes. Root `SKILL.md` is decoded as strict UTF-8. Any violation rejects the full set. A manifest file with role `script`, or a normalized path beginning with `scripts/`, rejects the full set before any content file is read. Artifact content is never executed.

## Telemetry

An optional sink receives `load.started`, `load.throttled`, `load.singleflight_joined`, `load.succeeded`, `load.failed`, and `status.changed`. Permitted fields are framework and adapter version, source/freshness/status, skill count, latency, Registry revision, joined count, and canonical error code/category/retryability/request ID/trace ID. Events never contain tokens, project namespace, learning-container ID, skill text, paths, or bundle contents. Sink failures are explicit and joined callers receive the same terminal exception. A telemetry callback that awaits a same-provider load or close rejects immediately with `LEARNING_REGISTRY_REENTRANT_LOAD` or `LEARNING_REGISTRY_REENTRANT_CLOSE` instead of self-awaiting.

## Errors

Authentication, permission, HTTP 401/403/404/410, archived container, project mismatch, container not found, and unrecoverable Registry errors permanently deny and clear the active native value. Transient and integrity refresh failures become `LEARNING_REGISTRY_STALE`. Adapter validation errors cover count, byte limits, strict UTF-8, executable artifacts, and unsupported descriptor projections.

## Closing

`await provider.aclose()` is idempotent. It cancels no model invocation already running with an immutable captured context. Closing clears the active value, disposes adapter lifecycle state, and every future fresh, cached, or request-time load rejects with `LEARNING_REGISTRY_CLOSED`.

## Compatibility

The verified minimum is `agent-framework-core==1.11.0`; the supported range ends before 2.0.0. The exact-minimum and newest-compatible probes verify public `agent_framework.ContextProvider`, async `before_run(*, agent, session, context, state)`, `SessionContext` as the native context result, `SessionContext.extend_instructions`, and `context_providers` as the registration keyword.

## Ownership and release

This adapter is owned by Intelligence/Learning. `copilotkit-intelligence-agent-framework` is independently versioned, tagged, built, and published; its release does not wait for or force another adapter or generic SDK release.
