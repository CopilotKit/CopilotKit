# Thread ID Frontend Tool Round Trip

## Scope

Regression checklist for ENT-658: a `CopilotChat` wrapped by
`CopilotChatConfigurationProvider` must keep its SDK-generated non-explicit
thread active across a frontend tool call and follow-up run.

## Manual QA

- [ ] Navigate to `/demos/threadid-frontend-tool-roundtrip`.
- [ ] Verify the chat input is visible and `Explicit threadId` is unchecked.
- [ ] Send `invoke testFrontendToolCalling with label X`.
- [ ] Verify the user message remains visible.
- [ ] Verify the `testFrontendToolCalling` card remains visible and shows
      `label: X` and `result: handled X`.
- [ ] Verify the assistant reply `Frontend tool finished for X.` appears.
- [ ] Verify the chat does not return to the empty state.
- [ ] Refresh the page or open a new tab, check `Explicit threadId` before
      sending any message, send the same prompt again, and verify the same
      message/tool/reply persistence behavior.
- [ ] Optionally toggle `Explicit threadId` after a generated-thread
      conversation and verify the chat switches to the explicit thread's
      history. An empty explicit thread on first use is expected.

## Automated Coverage

- `tests/e2e/threadid-frontend-tool-roundtrip.spec.ts` covers the demo route,
  generated-thread default state, and explicit-thread toggle.
- `packages/react-core/src/v2/components/chat/__tests__/CopilotChat.absentThreadConnect.test.tsx`
  covers the SDK-generated thread handoff at the component level.
