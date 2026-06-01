# QA: Interrupt (Headless) — LangGraph (Python)

> Stub — authored for column completeness. This is a testing-kind demo
> (see `kind: "testing"` in feature-registry.json) and does not warrant a
> full manual checklist.

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy

## Test Steps

- [ ] Navigate to /demos/interrupt-headless
- [ ] Send a scheduling prompt (e.g. "Book an intro call with sales") and verify a time-slot picker popup appears in the left app surface (not in the chat)
- [ ] Click one of the time-slot buttons and verify the popup disappears and the agent confirms the booking back in the chat

## Expected Results

- Page loads without errors
- Interrupt resolves via the plain button grid (no `useInterrupt` render prop, no in-chat picker) and the agent continues the run with the picked slot
