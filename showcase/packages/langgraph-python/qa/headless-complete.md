# QA: Fully Headless UI — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the demo page
- [ ] Verify the custom headless chat interface loads
- [ ] Send a basic message
- [ ] Verify the agent responds

### 2. Resolver-backed Tool Rendering

- [ ] Ask for the weather in a specific city
- [ ] Verify a weather loading state appears while the tool is running
- [ ] Verify the final weather card appears inside the custom headless message list
- [ ] Verify the page source/code tab uses `useToolRenderingResolver`

### 3. Error Handling

- [ ] Submit is disabled for an empty message
- [ ] Verify no console errors during normal usage

## Expected Results

- Headless chat loads within 3 seconds
- Agent responds within 10 seconds
- Weather tool UI renders through the resolver path
- No built-in `CopilotChat` component is used for the chat shell
