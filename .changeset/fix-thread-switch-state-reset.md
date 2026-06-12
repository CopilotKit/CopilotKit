---
"@copilotkit/core": patch
---

fix(core): only reset agent state and replay cursor on actual thread switch

`RunHandler.connectAgent` previously called `agent.setMessages([])` + `agent.setState({})` and the IntelligenceAgent delegate's `clearReconnectCursor` on every connect, including effect-dep churn re-connects on the same thread. That forced the realtime gateway to replay the topic's full event history every time the chat re-opened a socket — which under React effect churn happens 3-5 times per thread switch — and produced both halves of Tyler's bug: duplicate `cpki_event_id` rows in the inspector and intermittent "Message not found" toasts.

This change tracks the most recent connected threadId on `RunHandler` and gates the state-reset + cursor-clear on that threadId actually changing. Same-thread churn re-connects now preserve local messages/state and the gateway can resume from `lastSeenEventId`. Actual thread switches still wipe local state and ask for a full historical replay.

Supersedes #4720, which attempted to solve only the inspector duplicate-row symptom by adding a dispatcher dedup but introduced a regression in the A → B → A restore path (the dedup blocked the gateway's restore replay for thread A on second visit). The dispatcher dedup is removed entirely; the orchestrator-level gate is sufficient.

Adds focused unit tests covering: same-thread churn does not reset, cross-thread switch does reset, A → B → A resets each transition, and a regression test that replays the same `cpki_event_id` after a thread switch and verifies rehydrate still works.
