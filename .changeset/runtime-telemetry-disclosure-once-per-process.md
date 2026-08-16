---
"@copilotkit/runtime": patch
---

fix(runtime): log the anonymous telemetry disclosure once per process

The runtime's "anonymous telemetry enabled — see …/telemetry to opt out" disclosure is meant to print at most once per process, but its once-guard lived in a module-level variable. That guard is reborn whenever the module is re-evaluated, so in `next dev` — which compiles each API route in its own module context — the line re-fired on every route compile, and the V1 `CopilotRuntime` + lazy V2 `CopilotRuntimeVNext` constructors logged it twice on a single runtime build.

The guard now lives on a `Symbol.for`-keyed `globalThis` slot, which is shared across module re-evaluations and across the ESM/CJS package copies, so the disclosure prints exactly once per process. Production behavior is unchanged except that the occasional double-line is collapsed to one.
