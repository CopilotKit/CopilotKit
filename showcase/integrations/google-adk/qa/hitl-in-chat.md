# QA: Human in the Loop (in-chat) — Google ADK

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the HITL in-chat demo page (`/demos/hitl-in-chat`)
- [ ] Verify the chat interface loads in a centered max-w-4xl container
- [ ] Verify the chat input placeholder "Type a message" is visible

### 2. Suggestions

- [ ] Verify "Book a call with sales" suggestion pill is visible
- [ ] Verify "Schedule a 1:1 with Alice" suggestion pill is visible
- [ ] Click the "Book a call with sales" suggestion
- [ ] Verify the message
      "Please book an intro call with the sales team to discuss pricing."
      is sent

### 3. Time-picker card (book_call HITL flow)

The `book_call` HITL tool is defined on the frontend via
`useHumanInTheLoop`. The ADK agent (`hitl_in_chat_book_call_agent`) is
instructed to call that tool with `topic` + `attendee` args; the frontend
renders a `TimePickerCard` and forwards the user's choice back to the agent
as the tool result.

- [ ] Send "Schedule a 1:1 with Alice next week to review Q2 goals."
- [ ] Within 60s, the time-picker card renders
      (`data-testid="time-picker-card"`)
- [ ] Verify the card shows "With Alice" (attendee from tool args)
- [ ] Verify four time slots are visible (`data-testid="time-picker-slot"`)
- [ ] Click the first time slot
- [ ] Verify the card transitions to the picked state
      (`data-testid="time-picker-picked"`) showing "Booked for ..."
- [ ] Verify the agent's follow-up confirmation arrives within 30s and
      mentions Alice / the booked label

### 4. Sales-team flow (second suggestion)

- [ ] Send
      "Please book an intro call with the sales team to discuss pricing."
- [ ] Time-picker card renders within 60s
- [ ] Verify the card mentions the sales team
- [ ] Pick a slot; the picked-state card appears
- [ ] Agent's follow-up confirmation arrives mentioning "sales team"

### 5. Back-to-back flow (regression check)

- [ ] In the same session (no refresh), trigger both flows back-to-back:
  - Flow A: "Schedule a 1:1 with Alice next week to review Q2 goals."
  - Flow B: "Please book an intro call with the sales team to discuss pricing."
- [ ] Verify a SECOND time-picker card appears for Flow B
- [ ] Pick a slot in the new card; verify the sales-specific confirmation
      arrives without conflating with the Alice flow

### 6. Cancel path

- [ ] Trigger a booking flow
- [ ] Click "None of these work"
- [ ] Verify the cancelled-state card appears
      (`data-testid="time-picker-cancelled"`) reading "Cancelled — no time picked."

### 7. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage

## Expected Results

- Chat loads within 3 seconds
- Time-picker card appears within 60 seconds of the booking message
- Agent confirmation arrives within 30s of slot selection
- No UI errors or broken layouts
