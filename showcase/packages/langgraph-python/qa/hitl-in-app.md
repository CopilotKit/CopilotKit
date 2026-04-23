# QA: In-App Human in the Loop — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/hitl-in-app` on the dashboard host
- Agent backend is healthy (`/api/health`); `OPENAI_API_KEY` is set on Railway; `LANGGRAPH_DEPLOYMENT_URL` points at a LangGraph deployment exposing the `hitl_in_app` graph
- Note: Unlike the in-chat HITL demo, the approval UI here is an app-level modal portal'd to `document.body` and is NOT a child of the chat transcript.

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/hitl-in-app`; verify the page renders within 3s as a two-column layout — left column is the "Support Inbox" panel, right column is the `CopilotChat` surface (bordered, `w-[420px]`)
- [ ] Verify the left header shows the eyebrow "Support Inbox", heading "Open tickets", and the instruction text mentioning "approval dialog here in the app — outside the chat"
- [ ] Verify exactly 3 ticket cards render with test ids `ticket-12345`, `ticket-12346`, `ticket-12347`, each showing the customer name (Jordan Rivera / Priya Shah / Morgan Lee), subject line, and status pill ("Open" green, "Escalating" amber)
- [ ] Verify ticket #12345 displays "Disputed amount: $50.00"
- [ ] Verify the `CopilotChat` input placeholder is visible and no approval dialog is rendered on initial load
- [ ] Send "Hello" and verify the agent responds within 10s

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify all 3 suggestion pills are visible with verbatim titles:
  - "Approve refund for #12345"
  - "Downgrade plan for #12346"
  - "Escalate ticket #12347"

#### Approval Flow — Approve Path (useFrontendTool async handler)

- [ ] Click the "Approve refund for #12345" suggestion (or type the equivalent prompt)
- [ ] Within 15s verify an approval modal appears with `data-testid="approval-dialog-overlay"` (fullscreen fixed backdrop with `backdrop-blur-sm`) and `data-testid="approval-dialog"` (centered card with `role="dialog"` and `aria-modal="true"`)
- [ ] Verify the modal is rendered at the document root (portaled via `createPortal(content, document.body)`) — confirm in DevTools that `approval-dialog-overlay` is a direct descendant of `<body>`, NOT nested inside the `CopilotChat` container
- [ ] Verify the modal shows the eyebrow "Action requires your approval", a heading containing the action summary (with concrete numbers such as "$50" and "#12345"), and optional context block below
- [ ] Verify the textarea `data-testid="approval-dialog-reason"` is present with placeholder "Add a short note the assistant will see…"
- [ ] Type a short note (e.g. "Verified duplicate charge") into the reason textarea
- [ ] Click the `data-testid="approval-dialog-approve"` button (labeled "Approve")
- [ ] Verify the modal closes immediately and does NOT re-open
- [ ] Verify the agent resumes within 10s and replies in the chat with a one/two-sentence confirmation acknowledging the action is being processed (should reference the refund / #12345)

#### Approval Flow — Reject Path

- [ ] In a fresh conversation, click "Downgrade plan for #12346"
- [ ] Verify the approval modal re-opens (same testids as above) with a heading referencing Priya Shah / #12346 / Starter plan
- [ ] Type a rejection reason (e.g. "Customer must confirm in writing first")
- [ ] Click `data-testid="approval-dialog-reject"` (labeled "Reject")
- [ ] Verify the modal closes immediately
- [ ] Verify the agent's reply acknowledges the rejection in one or two sentences, reflects the rejection reason back, and does NOT claim the downgrade was performed

#### Empty-Reason Path

- [ ] Trigger the approval flow a third time via "Escalate ticket #12347"
- [ ] Leave the reason textarea empty and click Approve
- [ ] Verify the modal closes and the agent still proceeds with the action (reason is optional — omitted when empty)

#### Modal Is Outside the Chat (Contract Check)

- [ ] While the modal is open, verify the chat transcript is still scrollable / visible on the right and does NOT contain an inline copy of the approval UI
- [ ] Confirm that closing the modal via Approve/Reject is the only resolution path — there is no inline "approve" button rendered inside a chat bubble

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op (no user bubble, no assistant response)
- [ ] Trigger the approval flow and dismiss via Approve without touching the reason field — verify no console errors and the promise resolves
- [ ] Verify no uncaught console errors during any approve / reject cycle above

## Expected Results

- Chat loads within 3 seconds; initial agent response within 10 seconds
- Approval modal appears within 15 seconds of the triggering prompt
- Modal is portaled to `<body>` (NOT nested in the chat) and closes on Approve/Reject
- Approve path: agent acknowledges and proceeds; Reject path: agent acknowledges and stops, reflecting the reason when provided
- No UI layout breaks, no uncaught console errors, no stuck-open modal
