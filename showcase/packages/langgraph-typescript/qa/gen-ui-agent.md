# QA: Agentic Generative UI — LangGraph (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the gen-ui-agent demo page
- [ ] Verify the chat interface loads in a centered max-w-6xl container (md:w-4/5 md:h-4/5 rounded-lg wrapper)
- [ ] Verify the chat input placeholder "Type a message" is visible
- [ ] Send a basic message
- [ ] Verify the agent responds
- [ ] Verify the custom message list container is present (`data-testid="copilot-message-list"`)

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify "Simple plan" suggestion button is visible (plan to go to Mars in 5 steps)
- [ ] Verify "Complex plan" suggestion button is visible (plan to make pizza in 10 steps)

#### Task Progress Tracker (useAgent with OnStateChanged streaming)

- [ ] Click "Simple plan" suggestion or type "Build a plan to go to Mars in 5 steps"
- [ ] Verify the TaskProgress component renders (`data-testid="task-progress"`)
- [ ] Verify the "Task Progress" heading is visible with blue-to-purple gradient text
- [ ] Verify the progress bar appears with a gradient fill inside a rounded-full container
- [ ] Verify step items appear with descriptions (`data-testid="task-step-text"`)
- [ ] Verify the "N/N Complete" counter updates as steps complete
- [ ] Verify completed steps show:
  - Green-to-emerald background gradient
  - Check icon in a green gradient circle
  - Green text color (text-green-700)
- [ ] Verify the current pending step shows:
  - Blue-to-purple background gradient
  - Spinner icon with "Processing..." text
  - Pulsing animation overlay
  - Larger text-base size
- [ ] Verify future pending steps show:
  - Gray background (bg-gray-50/50)
  - Clock icon
  - Muted text color (text-gray-500)

#### Complex Plan

- [ ] Type "Plan to make pizza in 10 steps"
- [ ] Verify 10 steps appear in the progress tracker
- [ ] Verify progress bar width increases as steps complete
- [ ] Verify the LangGraph StateGraph node-based agent (chat_node, tool_node) streams partial state updates

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage

## Expected Results

- Chat loads within 3 seconds
- Agent responds within 10 seconds
- Task progress tracker shows live step completion driven by LangGraph-JS state streaming
- Progress bar animates smoothly
- No UI errors or broken layouts
