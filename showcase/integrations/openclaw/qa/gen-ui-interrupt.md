# QA: Gen UI Interrupt (OpenClaw)

Demo source: `src/app/demos/gen-ui-interrupt/page.tsx`
Route: `/demos/gen-ui-interrupt` · Agent: `gen-ui-interrupt`

> **Adapted, not native.** `gen-ui-interrupt` is listed under _Not supported_ in
> `PARITY_NOTES.md`: OpenClaw is a stateless gateway, not a graph engine, so it
> has **no LangGraph-style resumable `interrupt()`**. The LangGraph showcase's
> `useInterrupt({ renderInChat: true })` hook is silently dead here — it waits
> for AG-UI `interrupt` events this backend never emits. This demo reproduces
> the same UX by a **tool-based** route instead: the frontend registers
> `useHumanInTheLoop` for a `schedule_meeting` tool, renders a time-picker card
> inline, and resolves the call via `respond(...)`. Same look and feel as the
> LangGraph card; different mechanism (the fleet's `promise-based` HITL pattern).

## What it exercises

A human-in-the-loop tool (`schedule_meeting`) defined in React with
`useHumanInTheLoop`. Its schema is forwarded over AG-UI in `RunAgentInput.tools`;
the ag-ui adapter hands it to OpenClaw as a caller-provided **client tool**,
so the model can call it. When the model calls it, the run pauses on a pending
tool call, the `render(...)` callback draws a `TimePickerCard` inline in the
chat, and the user's chosen slot (or cancellation) is fed back to the agent via
`respond(...)`. The candidate time slots are generated **client-side** by
`generateFallbackSlots()` (relative to `Date.now()`), not by the backend.

## Manual steps

1. Open the demo. Confirm the chat composer renders and the two suggestion
   chips appear ("Book a call with sales", "Schedule a 1:1 with Alice").
2. Ask: **"Book an intro call with the sales team to discuss pricing."**
   (or click the first suggestion chip).
3. Expect: the agent calls `schedule_meeting` and a **Book a call** card renders
   inline in the chat, showing the topic and a 2x2 grid of time slots
   ("Tomorrow 10:00 AM", "Tomorrow 2:00 PM", "Monday 9:00 AM", "Monday 3:30 PM")
   plus a "None of these work" button.
4. Click a slot. Expect: the card collapses to a green **Booked** badge with the
   chosen label, and the agent replies confirming the chosen time (the picked
   slot is fed back via `respond`, so the confirmation references it).
5. Repeat with **"Schedule a 1:1 with Alice next week to review Q2 goals."**
   Confirm the card shows "With Alice" in the header.
6. On a fresh request, click **"None of these work"** instead. Expect: the card
   collapses to a red **Cancelled** badge, and the agent acknowledges that no
   time was picked.

## Assertion bar

- The picker actually renders **inline in the chat** (not a "[Scheduling...]"
  placeholder that never resolves — that stuck state is the symptom of the dead
  `useInterrupt` path and must not appear).
- Exactly one picker card per `schedule_meeting` call (no duplicate render).
- After a slot is picked, the buttons are disabled and the run continues — the
  agent's follow-up references the chosen slot.
- Cancelling resolves the call too (agent doesn't hang waiting).

## Known caveats

- Not a real resumable interrupt. There is no server-side pause/resume; the
  "interrupt" is a client tool whose promise is resolved by `respond(...)`. If
  you're comparing against langgraph-python, the round-trip mechanism differs
  even though the card is identical.
- Time slots are client-generated fallbacks. The LangGraph reference supplies
  slots inside the interrupt payload; OpenClaw's gateway sends none, so
  `generateFallbackSlots()` always runs. Labels are relative to now, so they
  won't decay ("Tomorrow", "Monday").
- The model must be steered to call `schedule_meeting`. Behaviour depends on the
  model choosing the tool for scheduling-shaped requests; phrase the prompt as a
  booking/scheduling ask (the suggestion chips are known-good prompts).

## Protocol-level check (no browser)

Inside the running container, POST a `RunAgentInput` carrying a
`schedule_meeting` tool to `http://127.0.0.1:8000/v1/ag-ui/operator`
(Bearer gateway token, `Accept: text/event-stream`) with a scheduling prompt,
and confirm the SSE contains a `TOOL_CALL_START` for `schedule_meeting` with
`topic` (and optional `attendee`) args, followed by `RUN_FINISHED`. The run
stops at the tool call — there is no `interrupt` event in the stream.
