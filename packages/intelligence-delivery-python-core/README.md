# Private Python delivery core

This project contains shared source for the LangGraph and ADK adapters. It is not a public distribution. `tool.uv.package = false` disables package installation and there is no build target or release configuration. Future adapter builds will vendor `src/_delivery` into each adapter's private namespace. Internal module imports are relative; the canonical Intelligence client remains an external dependency.

`Registry` resolves explicit configuration before environment values. An injected client supplies the connection and remains application-owned. Helper-created clients close through `Registry.aclose()`. Durations use seconds and default to five seconds. `initialize()` and `acquire_snapshot()` share one refresh task. Cancelling an invocation does not cancel that shared task. Closing the registry ends its owned work. The canonical client enforces the per-request HTTP deadline. Validation receives only the remaining time from the same budget. There is no competing registry HTTP timer. Injected clients must honor the canonical deadline contract; arbitrary transport implementations are outside this private API.

Snapshots contain frozen dataclasses and tuples. ZIP parsing uses memory only, with no extraction, execution, cache files, or content logs. Internal corruption limits are 32 MiB of archive bytes, 32 MiB of decoded entry bytes, and 1,000 entries, including the manifest and directories. Paths and names use strict UTF-8 and ascending UTF-8 byte order without normalization. Supporting binary resources have no readable text. Only verified manifest members reach a snapshot.

`status` is an immutable value with `initialized`, `revision`, `mode`, `last_checked_at`, `stale`, and `last_error`. Check timestamps use UTC ISO 8601 strings. Error status includes safe code, message, and retry guidance without the cause. Warm transient failures retain the prior snapshot indefinitely. Confirmed denial blocks new acquisitions until a successful authorized check. Existing snapshot references stay immutable.

The JSON files under `conformance` are copied unchanged from the TypeScript adapter checkpoint. They are temporary shared inputs for Python and .NET in this stack. After the TypeScript stack merges, move all language consumers to one repository-wide conformance location. Runtime socket fixtures remain separate.

Run `pnpm exec nx run intelligence-delivery-python-core:test`, `:lint`, and `:typecheck` from the repository root. These targets use this project's own uv environment.
