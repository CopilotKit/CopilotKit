---
"@copilotkit/runtime": patch
---

fix(runtime): coalesce consecutive same-role Anthropic messages before dispatch

Fixes multi-turn conversations with Anthropic where a text + tool_use turn produced
two consecutive assistant messages in the API payload, violating role-alternation and
causing subsequent assistant responses to appear appended to the previous message.
