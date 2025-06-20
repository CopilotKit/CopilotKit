---
"@copilotkit/react-core": patch
"@copilotkit/runtime": patch
"@copilotkit/shared": patch
---

- feat: add onTrace handler for comprehensive debugging and observability - Add CopilotTraceEvent interfaces with rich debugging context, implement runtime-side tracing with publicApiKey gating, add UI-side error tracing, include comprehensive test coverage, and fix tsup build config to exclude test files
- fix: extract publicApiKey for all requests + trace GraphQL errors
