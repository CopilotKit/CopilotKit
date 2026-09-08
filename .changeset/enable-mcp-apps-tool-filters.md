---
"@copilotkit/runtime": minor
---

fix(runtime): reject unenforceable mcpApps tool policy instead of silently ignoring it

Reject MCP Apps per-tool policy keys until the external middleware supports them, preventing silent configuration no-ops.
