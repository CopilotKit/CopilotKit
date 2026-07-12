---
"@copilotkit/shared": minor
"@copilotkit/runtime": minor
"@copilotkit/core": minor
"@copilotkit/web-inspector": minor
---

feat(runtime): add standalone telemetry identity and entitlement diagnostics

Runtime telemetry now accepts a public `telemetryId` option and falls back to `CPK_TELEMETRY_ID` before the legacy license-derived identity. Standalone identities travel only in the `X-CopilotKit-Telemetry-Id` header; existing telemetry opt-outs, anonymous sampling, identified-event sampling, Segment behavior, and legacy license fallback remain unchanged.

Runtime also fetches structured Intelligence entitlement state and exposes it through `/info`. The shared Runtime info types describe the response, Core retains the state for browser consumers, and Web Inspector displays the resulting entitlement diagnostics. Web Inspector telemetry transport, identity, event names, aliasing, and opt-outs are unchanged.
