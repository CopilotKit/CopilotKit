# QA: Interrupt (Headless) — Mastra

> Stub — authored for column completeness. This is a testing-kind demo
> (see `kind: "testing"` in feature-registry.json) and does not warrant a
> full manual checklist.

## Prerequisites

- Demo is deployed and accessible at `/demos/interrupt-headless`
- Agent backend is healthy; `OPENAI_API_KEY` is set
- Same NATIVE suspend backend as gen-ui-interrupt (the `schedule_meeting` tool
  `suspend()`s → `@ag-ui/mastra` bridge → AG-UI interrupt). The DIFFERENCE is
  the frontend: `useInterrupt({ renderInChat: false })` returns the picker
  element, which the demo places in the LEFT app-surface pane instead of the
  chat.

## Test Steps

- [ ] Navigate to `/demos/interrupt-headless`; verify the empty state renders (`data-testid="interrupt-headless-empty"`) in the left app surface
- [ ] Send a scheduling prompt (e.g. "Book an intro call with the sales team to discuss pricing.") and verify a time-slot popup (`data-testid="interrupt-headless-popup"`) appears in the LEFT app surface, NOT in the chat
- [ ] Click one of the slot buttons (`data-testid^="interrupt-headless-slot-"`) and verify the popup unmounts back to the empty state and the agent confirms the booking back in the chat

## Expected Results

- Page loads without errors
- Interrupt resolves via the plain button grid (headless — the picker renders in
  the app surface, not in-chat) and the Mastra run resumes with the picked slot
