# QA: In-Chat HITL via useInterrupt — Mastra

## Prerequisites

- Demo is deployed and accessible at `/demos/gen-ui-interrupt` on the dashboard host
- Agent backend is healthy (`/api/health`); `OPENAI_API_KEY` is set on Railway
- Note: The picker card renders INLINE inside the chat transcript via
  `useInterrupt({ renderInChat: true })`. Unlike LangGraph's `interrupt()`, the
  Mastra path is a NATIVE suspend TOOL: the backend `schedule_meeting`
  (`src/mastra/tools/interrupt.ts`) calls `suspend({ topic, attendee, slots })`,
  the `@ag-ui/mastra` bridge maps that suspend to an AG-UI interrupt (legacy
  `on_interrupt` CUSTOM event + the standard `RUN_FINISHED` interrupt-outcome),
  and `useInterrupt` renders the `TimePickerCard`. Picking a slot `resolve(...)`s,
  which resumes the Mastra run (re-invoking the tool's `execute` with
  `resumeData`).

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/gen-ui-interrupt`; verify the page renders within 3s with the `CopilotChat` in a `max-w-4xl`, full-height, `rounded-2xl` container
- [ ] Verify the chat input placeholder is visible and the transcript is empty on first load, with no `data-testid="time-picker-card"` present
- [ ] Send "Hello" and verify the agent responds with a text-only reply (no picker — the agent only calls `schedule_meeting` when explicitly asked to book/schedule)

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify both suggestion pills are visible with verbatim titles:
  - "Book a call with sales"
  - "Schedule a 1:1 with Alice"

#### Interrupt Trigger + Inline Render (useInterrupt low-level primitive)

- [ ] Click "Book a call with sales" (or type "Use schedule_meeting to book an intro call with the sales team about pricing.")
- [ ] Within 60s verify the agent invokes `schedule_meeting`, the backend tool `suspend()`s, and a picker renders INLINE with `data-testid="time-picker-card"`
- [ ] Confirm the card IS a descendant of the chat transcript (NOT portaled to `<body>`, unlike the `hitl-in-app` modal) — no `body > [data-testid="time-picker-card"]`
- [ ] Verify the card header shows the "Book a call" eyebrow badge, a topic title, and the "Pick a time that works for you." description
- [ ] Verify a 2x2 grid of exactly 4 slot buttons (`data-testid="time-picker-slot"`) with the backend-generated labels (relative to now):
  - "Tomorrow 10:00 AM"
  - "Tomorrow 2:00 PM"
  - "Monday 9:00 AM"
  - "Monday 3:30 PM"
- [ ] Verify a "None of these work" ghost button (`data-testid="time-picker-cancel"`) below the grid

#### Pick-a-Slot Resume Path

- [ ] Click one of the four slot buttons (e.g. "Monday 9:00 AM")
- [ ] Verify the card switches to `data-testid="time-picker-picked"` — a "Booked" success badge with the chosen label in bold — and the interactive card unmounts (no `time-picker-card`)
- [ ] Verify the agent resumes and produces a chat reply confirming the meeting (backend returns `Scheduled "{topic}" for {chosen_label}.`)

#### Cancel Path

- [ ] Send "Use schedule_meeting to book a 1:1 with Alice next week to review Q2 goals."
- [ ] Verify a fresh picker renders inline (`data-testid="time-picker-card"`); the "With Alice" attendee line appears next to the eyebrow when the agent supplies an attendee
- [ ] Click "None of these work"
- [ ] Verify the card switches to `data-testid="time-picker-cancelled"` — a "Cancelled" badge with "No time picked."
- [ ] Verify the agent resumes and replies that the meeting was NOT scheduled

#### Multi-Turn

- [ ] After a pick or cancel, send one more booking prompt; verify a new independent picker renders (prior card stays resolved), the interrupt lifecycle repeats cleanly, and a second resume works end-to-end

#### Contract Check — Interrupt Is Low-Level

- [ ] Confirm only the tool-triggered path renders the picker: a plain conversational message ("What's the weather?") should NOT render a picker
- [ ] Confirm no approval-dialog-style modal appears (this demo is inline, not modal)
- [ ] Note: the picker shows the tool's `topic`, which comes from the model's tool-call args and is NOT deterministic — do not assert on the topic text

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op
- [ ] Double-click a slot button rapidly; verify only one selection commits (buttons disable on first pick/cancel)
- [ ] Verify no uncaught console errors across pick / cancel / multi-turn

## Expected Results

- Chat loads within 3 seconds; plain-text response within 10 seconds
- Picker renders inline within 60 seconds of a schedule/booking prompt
- Picker resolves via a slot button (`{chosen_time, chosen_label}`) or "None of these work" (`{cancelled: true}`); post-resolution the card is read-only
- Agent resume produces a confirmation that references the chosen slot or the cancellation
- No layout breaks, no uncaught console errors, no duplicate pickers from a single interrupt
