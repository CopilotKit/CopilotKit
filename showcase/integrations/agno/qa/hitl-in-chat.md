# QA: In-Chat HITL (useHumanInTheLoop) — Agno

## Prerequisites

- Demo deployed at `/demos/hitl-in-chat`
- Agent backend healthy

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/hitl-in-chat`
- [ ] Verify chat renders with "Book a call with sales" and "Schedule a 1:1 with Alice" suggestion pills

### 2. Feature-Specific Checks

- [ ] Click "Book a call with sales"
- [ ] Verify `data-testid="time-picker-card"` is rendered with a grid of time slots
- [ ] Click one of the time slot buttons
- [ ] Verify `data-testid="time-picker-picked"` appears with the chosen slot label
- [ ] Verify the agent receives the chosen time (assistant follow-up references the booking)

#### Cancel Path

- [ ] Re-run with "Schedule a 1:1 with Alice"
- [ ] Click "None of these work"
- [ ] Verify `data-testid="time-picker-cancelled"` appears

### 3. Error Handling

- [ ] No uncaught console errors

## Note on the legacy /demos/hitl cell

The older `/demos/hitl` page in this package uses a StepSelector pattern driven by
`generate_task_steps` and a different HITL hook; it remains in the manifest as
`hitl-in-chat` (for UI-card parity). This file documents the newer `/demos/hitl-in-chat`
route that mirrors the canonical langgraph-python `hitl-in-chat` demo.
