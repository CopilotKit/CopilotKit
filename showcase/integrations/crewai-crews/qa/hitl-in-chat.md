# QA: Human in the Loop — CrewAI (Crews)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the HITL demo page (`/demos/hitl`) > _Note: the URL path `/demos/hitl` is intentionally shorter than the feature id `hitl-in-chat`._
- [ ] Verify the chat interface loads in a centered max-w-4xl container
- [ ] Verify the chat input placeholder "Type a message" is visible
- [ ] Send a basic message
- [ ] Verify the agent responds

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify "Simple plan" suggestion button is visible
- [ ] Verify "Complex plan" suggestion button is visible
- [ ] Click the "Simple plan" suggestion
- [ ] Verify it triggers a message about planning a trip to Mars in 5 steps

#### Step Selection and Approval

The HITL demo renders a single StepSelector card regardless of whether
the underlying flow uses an interrupt hook or a frontend HITL tool. The
framework-specific hook name is an implementation detail covered in each
package's demo source; QA below validates the user-visible card behavior.

- [ ] Send "Plan a trip to Mars in 5 steps"
- [ ] Verify the StepSelector card appears (`data-testid="select-steps"`)
- [ ] Verify step items are displayed with checkboxes (`data-testid="step-item"`)
- [ ] Verify step text is visible (`data-testid="step-text"`)
- [ ] Verify the selected count display shows "N/N selected"
- [ ] Toggle a step checkbox off and verify the count decreases
- [ ] Toggle it back on and verify the count increases
- [ ] Click "Perform Steps (N)" / "Confirm (N)" button
- [ ] Verify the agent continues processing after confirmation
- [ ] In a new conversation, trigger the same flow and click "Reject" (where present)
- [ ] Verify the card reflects the decision (Accepted / Rejected) and buttons disable

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage

## Expected Results

- Chat loads within 3 seconds
- Agent responds within 10 seconds
- Step selector renders with toggleable checkboxes
- Accept/Reject flow completes without errors
- No UI errors or broken layouts
