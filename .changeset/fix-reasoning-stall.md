---
"@copilotkit/runtime": patch
---

fix(agent): harden BuiltInAgent reasoning lifecycle

- Skip empty reasoning deltas (violates @ag-ui/core schema)
- Auto-close reasoning lifecycle when SDK omits reasoning-end (on consecutive-start, phase transitions, abort, error, and fallback paths)
- Make reasoning-end idempotent to prevent duplicate close events when auto-close already fired
- Regenerate reasoningMessageId for consecutive reasoning blocks when SDK provides no id
- Close reasoning in outer catch block so exceptions mid-reasoning emit proper lifecycle events
