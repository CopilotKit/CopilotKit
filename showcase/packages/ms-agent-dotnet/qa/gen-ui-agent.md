# QA: Agentic Generative UI — Microsoft Agent Framework (.NET)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the gen-ui-agent demo page
- [ ] Verify the chat interface loads in a centered layout (`md:w-4/5 md:h-4/5` rounded container)
- [ ] Verify the chat input placeholder "Type a message" is visible
- [ ] Verify the custom message list container is present (`data-testid="copilot-message-list"`)
- [ ] Send a basic message (e.g. "Hello")
- [ ] Verify the agent responds with an assistant message (`[data-role="assistant"]`)

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify "Simple plan" suggestion button is visible (plan to go to mars in 5 steps)
- [ ] Verify "Complex plan" suggestion button is visible (plan to make pizza in 10 steps)

#### Task Progress Tracker (useAgent with state streaming)

- [ ] Click "Simple plan" suggestion or type "Please build a plan to go to mars in 5 steps."
- [ ] Verify the TaskProgress component renders (`data-testid="task-progress"`)
- [ ] Verify the "Task Progress" heading is visible with a gradient text style
- [ ] Verify a progress bar appears with a blue-to-purple gradient fill
- [ ] Verify the "N/N Complete" counter updates as steps complete
- [ ] Verify step items appear with descriptions (`data-testid="task-step-text"`)
- [ ] Verify completed steps show:
  - Green gradient background (`from-green-50 to-emerald-50`)
  - Check icon in a green circular badge
  - Green text color (`text-green-700`)
- [ ] Verify the current pending step shows:
  - Blue/purple gradient background (`from-blue-50 to-purple-50`)
  - Spinner icon with "Processing..." text
  - Pulsing animation overlay
- [ ] Verify future pending steps show:
  - Gray background (`bg-gray-50/50`)
  - Clock icon
  - Muted gray text color

#### Complex Plan

- [ ] Click "Complex plan" suggestion or type "Please build a plan to make pizza in 10 steps."
- [ ] Verify 10 steps appear in the progress tracker
- [ ] Verify the progress bar width increases proportionally as steps complete

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage

## Expected Results

- Chat loads within 3 seconds
- Agent responds within 10 seconds
- Task progress tracker shows live step completion driven by agent state updates
- Progress bar animates smoothly with the blue-to-purple gradient
- No UI errors or broken layouts
