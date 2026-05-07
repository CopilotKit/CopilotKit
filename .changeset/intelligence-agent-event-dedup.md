---
"@copilotkit/core": patch
---

fix(core): dedup `cpki_event_id` deliveries inside `IntelligenceAgent.createThreadNotifications` so verbatim replays from the realtime gateway no longer fan out duplicate `agent.subscribe(...)` callbacks. When the chat re-opens a thread channel under React effect churn or transient reconnects, the gateway answers the join with a full historical replay; without this gate every replayed event re-fires every subscriber (visible as duplicate rows in the inspector AG-UI Events tab and as redundant message-state mutations downstream). Memory is bounded per-thread with FIFO eviction at 2000 entries.
