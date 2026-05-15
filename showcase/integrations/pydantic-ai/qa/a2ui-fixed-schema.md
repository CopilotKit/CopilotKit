# QA: A2UI — Fixed Schema — PydanticAI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- `OPENAI_API_KEY` set

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/a2ui-fixed-schema`
- [ ] Verify the chat interface loads and the suggestion pill renders

### 2. Fixed Schema Render

- [ ] Click the "Find SFO → JFK" suggestion
- [ ] Verify the agent calls `display_flight` and a flight card renders
      inline with origin/destination codes, airline badge, and price
- [ ] Click the "Book flight" button; verify it transitions to a
      "Booked ✓" confirmation state (local frontend state)

### 3. Error Handling

- [ ] Verify no console errors during normal usage

## Expected Results

- The backend emits an `a2ui_operations` container wrapping the fixed
  flight schema with the provided data
- The frontend catalog maps the fixed schema's component names to its
  branded React renderers
