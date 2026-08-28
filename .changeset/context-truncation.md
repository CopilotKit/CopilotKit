---
"@copilotkit/runtime": patch
---

Truncate oversized application-context values (to 20k chars) when assembling the system prompt, preventing context bloat when large data is shared with the agent.
