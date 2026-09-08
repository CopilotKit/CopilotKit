# Thread ID Frontend Tool Round Trip

## Scope

Regression checklist for ENT-658: a `CopilotChat` wrapped by
`CopilotChatConfigurationProvider` must keep its SDK-generated non-explicit
thread active across a frontend tool call and follow-up run. On this
integration the chat is wired to `runtimeUrl="/api/copilotkit"` with agent
`threadid-frontend-tool-roundtrip`, which has no dedicated FastAPI endpoint —
it falls through to the root `POST /` agent in `src/agents/agent.py`.

## Manual QA

- [ ] Navigate to `/demos/threadid-frontend-tool-roundtrip`.
- [ ] Verify the chat input is visible and `Explicit threadId` is unchecked,
      and `data-testid="ent-658-thread-mode"` reads `SDK-generated thread`.
- [ ] Send `invoke testFrontendToolCalling with label X`.
- [ ] Verify the user message remains visible.
- [ ] Verify the `data-testid="ent-658-tool-card"` card remains visible and
      shows `label: X` and `result: handled X`.
- [ ] Verify an assistant follow-up reply appears (`followUp: true` on the
      tool guarantees a second run; the recorded fixture asserts the verbatim
      `Frontend tool finished for X.` — against a live model the wording may
      differ, but a follow-up assistant message MUST appear).
- [ ] Verify the chat does not return to the empty state.
- [ ] Refresh the page or open a new tab, check `Explicit threadId` before
      sending any message (the mode line must flip to `Explicit thread`), send
      the same prompt again, and verify the same message/tool/reply
      persistence behavior.
- [ ] Optionally toggle `Explicit threadId` after a generated-thread
      conversation and verify the chat switches to the explicit thread's
      history. An empty explicit thread on first use is expected.

## Automated Coverage

- `showcase/harness/src/probes/scripts/d5-threadid-frontend-tool-roundtrip.ts`
  is the shared probe run against every integration (it asserts the
  `Frontend tool finished for X.` page text).
- `showcase/aimock/d6/claude-sdk-python/threadid-frontend-tool-roundtrip.json`
  is this integration's fixture: turn 1 emits the `testFrontendToolCalling`
  call, turn 2 confirms the tool result without changing threads.
- `packages/react-core/src/v2/components/chat/__tests__/CopilotChat.absentThreadConnect.test.tsx`
  covers the SDK-generated thread handoff at the component level.
