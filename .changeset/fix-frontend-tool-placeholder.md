---
"@copilotkit/core": patch
---

fix(core): execute frontend tools when backend returns placeholder result

Frontend tools registered via `useFrontendTool` now correctly execute after HITL approval with remote agents (Strands, LangGraph, CrewAI) instead of being silently skipped by the backend's placeholder result.
