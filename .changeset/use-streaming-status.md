---
"@copilotkitnext/react": minor
---

feat(react): add `useStreamingStatus` hook for granular AG-UI event phase awareness

Exposes the real-time streaming phase of the current agent run as React state — `idle`, `reasoning`, `tool_calling`, and `streaming` — along with the active `toolName` and `toolCallId`. Phase-end events are guarded against out-of-order delivery. Lets developers build phase-aware UI (status badges, progress indicators, tool-specific feedback) without manually subscribing to low-level AG-UI events.
