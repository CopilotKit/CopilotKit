# QA: In-Chat HITL via useInterrupt — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/gen-ui-interrupt` on the dashboard host
- Agent backend is healthy (`/api/health`); `OPENAI_API_KEY` is set on Railway; `LANGGRAPH_DEPLOYMENT_URL` points at a LangGraph deployment exposing the `interrupt_agent` graph
- Note: The picker card is rendered INLINE inside the chat transcript via `useInterrupt({ renderInChat: true })`, wired to langgraph's `interrupt()` primitive from the backend `schedule_meeting` tool.

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/gen-ui-interrupt`; verify the page renders within 3s with the `CopilotChat` centered in a `max-w-4xl` container filling full viewport height, with rounded (`rounded-2xl`) styling
- [ ] Verify the `CopilotChat` input placeholder is visible and the transcript is empty on first load
- [ ] Send "Hello" and verify the agent responds with a text-only reply (no time picker rendered — the agent only calls `schedule_meeting` when explicitly asked to book/schedule)

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify both suggestion pills are visible with verbatim titles:
  - "Book a call with sales"
  - "Schedule a 1:1 with Alice"

#### Interrupt Trigger + Inline Render (useInterrupt low-level primitive)

- [ ] Click the "Book a call with sales" suggestion (or prompt equivalently)
- [ ] Within 20s verify the agent invokes `schedule_meeting`, the backend hits `interrupt({topic, attendee})`, and a time-picker card renders INLINE inside the chat transcript with `data-testid="time-picker-card"`
- [ ] Confirm the card IS a descendant of the chat transcript container (NOT portaled to `<body>`, unlike the `hitl-in-app` modal) — inspect in DevTools to verify the card sits between chat message bubbles
- [ ] Verify the card header shows eyebrow "Book a call" and a topic heading reflecting the agent-supplied topic (e.g. contains "sales" / "pricing")
- [ ] Verify the "Pick a time:" subheading and a 2x2 grid of exactly 4 slot buttons with the default labels:
  - "Tomorrow 10:00 AM"
  - "Tomorrow 2:00 PM"
  - "Monday 9:00 AM"
  - "Monday 3:30 PM"
- [ ] Verify a "None of these work" ghost button is rendered below the slot grid

#### Pick-a-Slot Resume Path

- [ ] Click one of the four time slot buttons (e.g. "Monday 9:00 AM")
- [ ] Verify the card immediately switches to the confirmed state: `data-testid="time-picker-picked"`, green-tinted border/background, and text "Booked for <chosen label>" with the label in bold
- [ ] Verify all slot buttons disable (opacity reduced) and cannot be re-clicked
- [ ] Verify the agent resumes within 10s and produces a chat reply confirming the meeting was scheduled for the chosen label (backend returns `"Meeting scheduled for {chosen_label}: {topic}"`)

#### Cancel Path

- [ ] Send a second prompt "Schedule a 1:1 with Alice next week to review Q2 goals."
- [ ] Verify a fresh time-picker card renders inline (`data-testid="time-picker-card"`) — attendee line "With Alice" should appear under the topic
- [ ] Click the "None of these work" button
- [ ] Verify the card switches to `data-testid="time-picker-cancelled"` with the text "Cancelled — no time picked."
- [ ] Verify the agent resumes and replies that the meeting was NOT scheduled / the user cancelled

#### Multi-Turn

- [ ] After completing either the pick or cancel path, send one more prompt "Book another call tomorrow morning"
- [ ] Verify a new, independent time-picker card renders inline (previous card stays in its resolved state), the interrupt lifecycle repeats cleanly, and a second resume works end-to-end

#### Contract Check — Interrupt Is Low-Level

- [ ] Confirm only the tool-triggered path renders the picker: sending a plain conversational message ("What's the weather?") should NOT render a picker
- [ ] Confirm no approval-dialog-style modal appears at any point (this demo is inline, not modal)

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op
- [ ] Attempt to double-click a slot button rapidly; verify only one selection is committed (button disables on first click)
- [ ] Verify no uncaught console errors across any pick / cancel / multi-turn flow above

## Expected Results

- Chat loads within 3 seconds; plain-text response within 10 seconds
- Time picker card renders inline in the chat within 20 seconds of a schedule/booking prompt
- Picker resolves via either a slot button (emits `{chosen_time, chosen_label}`) or the "None of these work" button (emits `{cancelled: true}`); post-resolution the card is read-only
- Agent resume produces a confirmation message that references the chosen slot label or the cancellation
- No UI layout breaks, no uncaught console errors, no duplicate pickers from a single interrupt
