---
"@copilotkit/shared": patch
"@copilotkit/runtime": patch
"@copilotkit/core": patch
"@copilotkit/react-core": patch
"@copilotkit/vue": patch
---

fix: respect per-agent A2UI scoping instead of injecting the catalog context into every agent's runs (#5369)

When `CopilotRuntime` is configured with `a2ui: { agents: [...] }`, the
runtime-info response flattened that scoping into an endpoint-wide
`a2uiEnabled` boolean, so the client injected the full A2UI catalog context
(capabilities, component JSON Schema, generation and design guidelines —
~30KB) into **every** agent run on the endpoint, including agents that have
nothing to do with A2UI.

- `@copilotkit/runtime` now forwards the scoping in the info response as
  `a2ui: { enabled, agents }` (the legacy `a2uiEnabled` boolean is kept for
  older clients).
- `@copilotkit/core` preserves the list as `a2uiAgents`, context entries can
  carry an optional `agentIds` scope, and agent runs only receive entries
  scoped to them (unscoped entries behave exactly as before).
- `@copilotkit/react-core` and `@copilotkit/vue` scope the A2UI catalog
  context entries to the runtime's a2ui agents.
