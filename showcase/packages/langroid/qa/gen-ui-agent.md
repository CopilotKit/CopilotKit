# QA: Agentic Generative UI — Langroid

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the gen-ui-agent demo page
- [ ] Verify the chat interface loads in a centered full-height layout (`h-full w-full md:w-4/5 md:h-4/5`)
- [ ] Verify the chat input placeholder "Type a message" is visible
- [ ] Verify the custom message list container is rendered (`data-testid="copilot-message-list"`)
- [ ] Send a basic message (e.g. "Hello")
- [ ] Verify the agent responds with an assistant role message (`[data-role="assistant"]`)

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify "Simple plan" suggestion button is visible (triggers "Please build a plan to go to mars in 5 steps.")
- [ ] Verify "Complex plan" suggestion button is visible (triggers "Please build a plan to make pizza in 10 steps.")

#### Task Progress Tracker (useAgent with state streaming)

- [ ] Click "Simple plan" suggestion or type "Please build a plan to go to mars in 5 steps."
- [ ] Verify the TaskProgress component renders (`data-testid="task-progress"`)
- [ ] Verify the "Task Progress" heading is visible with gradient text styling
- [ ] Verify the "N/N Complete" counter is visible and matches the step count
- [ ] Verify the progress bar appears (a `.rounded-full` element inside the tracker) with a gradient fill
- [ ] Verify step items appear with descriptions (`data-testid="task-step-text"`)
- [ ] Verify completed steps show:
  - Green background gradient (`from-green-50 to-emerald-50`)
  - Green check icon with gradient background (`from-green-500 to-emerald-600`)
  - Green text color (`text-green-700`)
- [ ] Verify the current pending step shows:
  - Blue/purple background gradient (`from-blue-50 to-purple-50`)
  - Spinner icon with "Processing..." text
  - Pulsing animation overlay
- [ ] Verify future pending steps show:
  - Gray background (`bg-gray-50/50`)
  - Clock icon
  - Muted gray text (`text-gray-500`)

#### Complex Plan

- [ ] Type "Please build a plan to make pizza in 10 steps."
- [ ] Verify 10 task-step-text items render in the TaskProgress tracker
- [ ] Verify the progress bar width increases (`width: %`) as steps transition to completed
- [ ] Verify the completion counter increments accordingly

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage
- [ ] Send a very long message and verify no UI breakage

## Expected Results

- Chat loads within 3 seconds
- Agent responds within 10 seconds
- Task progress tracker shows live step completion via streamed agent state
- Progress bar animates smoothly (`transition-all duration-1000 ease-out`)
- No UI errors or broken layouts
