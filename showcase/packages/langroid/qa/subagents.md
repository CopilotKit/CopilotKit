# QA: Sub-Agents — Langroid

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the subagents demo page
- [ ] Verify the chat interface loads at full viewport height (`height: 100vh`)
- [ ] Verify the chat title "Sub-Agents" is displayed
- [ ] Verify the chat input placeholder "Type a message..." is visible
- [ ] Send a basic message (e.g. "Hello! What can you do?")
- [ ] Verify the agent responds with an assistant role message (`[data-role="assistant"]`)

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify "Get started" suggestion button is visible (triggers "Hello! What can you do?")
- [ ] Click the "Get started" suggestion and verify a message is sent / input populated

#### Note: Stub Demo

- [ ] This demo is currently a stub (TODO: implement Sub-Agents)
- [ ] Verify the basic CopilotChat loads and accepts messages
- [ ] Verify the agent responds to messages
- [ ] No custom UI components are expected beyond the chat interface

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage

## Expected Results

- Chat loads within 3 seconds
- Agent responds within 10 seconds
- No UI errors or broken layouts

## Notes

- Stub-vs-test mismatch: the e2e spec `tests/e2e/subagents.spec.ts` expects a TravelPlanner dashboard with "Current Itinerary" section, "Travel Planning Assistant" sidebar, agent indicators (`data-testid="supervisor-indicator"`, `flights-indicator`, `hotels-indicator`, `experiences-indicator`), empty-state strings like "No items yet -- start planning!", "No flights found yet", "No hotels found yet", "No experiences planned yet", and section headings "Flight Options" / "Hotel Options" / "Experiences". The page is a stub CopilotChat with "Sub-Agents" title — none of those selectors exist. Tests will fail against this stub.
