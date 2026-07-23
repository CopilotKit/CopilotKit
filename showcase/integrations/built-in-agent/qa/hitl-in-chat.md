# QA: In-Chat Human in the Loop — Built-in Agent (TanStack AI)

## Prerequisites

- Set `OPENAI_API_KEY` in `.env.local` (or environment).
- Run `npm install --legacy-peer-deps && npm run dev` from the `built-in-agent/` package directory.
- Demo URL: `http://localhost:3000/demos/hitl`

## Page load

- [ ] Page heading "In-Chat Human in the Loop" is visible.
- [ ] Hint text 'Try: "Delete the README; it\'s outdated."' is visible.
- [ ] Chat input is visible.

## Happy path interaction

- [ ] Send: "Delete the README; it's outdated." Verify an inline approval card appears in the chat showing the action name and reason, with green "Approve" and red "Reject" buttons.
- [ ] Click "Approve". Verify the card transitions to a "Decision recorded" state showing the action name, and the agent continues its response.
- [ ] In a fresh conversation, send the same prompt and click "Reject". Verify the card records the rejection and the agent acknowledges the refusal.

## Edge cases worth checking

- [ ] Once a decision has been recorded (Approve or Reject), verify the Approve/Reject buttons are no longer rendered (card shows completed state instead).
- [ ] Send a message that does not trigger the `approveAction` tool (e.g. "What is 2+2?"). Verify the agent replies normally without showing an approval card.
