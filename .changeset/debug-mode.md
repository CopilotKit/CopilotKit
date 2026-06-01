---
"@copilotkit/shared": minor
"@copilotkit/runtime": minor
"@copilotkit/react-core": minor
"@copilotkit/core": minor
---

feat: add debug mode to runtime and client

Add `debug` option to `CopilotRuntime` constructor and `<CopilotKit>` provider for detailed event pipeline logging. Server-side uses Pino structured logger; client-side passes config through to AG-UI transport. Accepts `true` for default output or a granular config: `{ events, lifecycle, verbose }`.
