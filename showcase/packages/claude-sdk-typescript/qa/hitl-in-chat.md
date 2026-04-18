# QA: Human in the Loop — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the hitl demo page
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

#### LangGraph Interrupt (useLangGraphInterrupt)

- [ ] Send "Plan a trip to Mars in 5 steps"
- [ ] Verify the StepSelector card appears (`data-testid="select-steps"`)
- [ ] Verify step items are displayed with checkboxes (`data-testid="step-item"`)
- [ ] Verify step text is visible (`data-testid="step-text"`)
- [ ] Verify the selected count display shows "N/N selected"
- [ ] Toggle a step checkbox off and verify the count decreases
- [ ] Toggle it back on and verify the count increases
- [ ] Click "Perform Steps (N)" button
- [ ] Verify the agent continues processing after confirmation

#### Human-in-the-Loop Feedback (useHumanInTheLoop)

- [ ] Trigger a task that generates steps via the generate_task_steps tool
- [ ] Verify the "Review Steps" card appears (`data-testid="select-steps"`)
- [ ] Verify Accept and Reject buttons are visible
- [ ] Click "Confirm (N)" and verify the card shows "Accepted" status
- [ ] In a new conversation, trigger the same flow and click "Reject"
- [ ] Verify the card shows "Rejected" status
- [ ] Verify buttons are disabled after a decision is made

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage

## Expected Results

- Chat loads within 3 seconds
- Agent responds within 10 seconds
- Step selector renders with toggleable checkboxes
- Accept/Reject flow completes without errors
- No UI errors or broken layouts
