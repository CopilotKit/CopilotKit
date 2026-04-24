# QA: Read-Only Agent Context — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- Graph `readonly_state_agent_context` is registered in the runtime (see `api/copilotkit/route.ts`)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the readonly-state-agent-context demo page
- [ ] Verify the "Agent Context" card is visible (`data-testid="context-card"`)
- [ ] Verify the description text references `useAgentContext`: "Read-only context provided to the agent via `useAgentContext`. The agent cannot modify these."
- [ ] Verify the chat panel renders on the right with placeholder "Ask about your context..."
- [ ] Send a basic message (e.g. "Hello") via the chat
- [ ] Verify the agent responds with a text message

### 2. Feature-Specific Checks

#### Initial Context State

- [ ] Verify the Name input (`data-testid="ctx-name"`) defaults to "Atai"
- [ ] Verify the Timezone dropdown (`data-testid="ctx-timezone"`) defaults to "America/Los_Angeles"
- [ ] Verify the Timezone dropdown offers: America/Los_Angeles, America/New_York, Europe/London, Europe/Berlin, Asia/Tokyo, Australia/Sydney
- [ ] Verify the Recent Activity checkboxes list: "Viewed the pricing page", "Added 'Pro Plan' to cart", "Watched the product demo video", "Started the 14-day free trial", "Invited a teammate"
- [ ] Verify two activities are checked by default: "Viewed the pricing page" and "Watched the product demo video"
- [ ] Verify the Published Context JSON preview (`data-testid="ctx-state-json"`) shows `{ "name": "Atai", "timezone": "America/Los_Angeles", "recentActivity": [...] }`

#### Suggestions

- [ ] Verify "Who am I?" suggestion is visible
- [ ] Verify "Suggest next steps" suggestion is visible
- [ ] Verify "Plan my morning" suggestion is visible

#### Agent Reads User Name (useAgentContext)

- [ ] Click the "Who am I?" suggestion (or ask "What is my name?")
- [ ] Verify the agent response addresses the user as "Atai"
- [ ] Edit the Name input (`data-testid="ctx-name"`) to "Jamie"
- [ ] Verify the Published Context JSON updates to show `"name": "Jamie"`
- [ ] Ask "What is my name?" again
- [ ] Verify the agent now responds with "Jamie" (not "Atai")

#### Agent Reads Timezone

- [ ] Change the Timezone dropdown (`data-testid="ctx-timezone"`) to "Asia/Tokyo"
- [ ] Verify the Published Context JSON updates to `"timezone": "Asia/Tokyo"`
- [ ] Click the "Plan my morning" suggestion
- [ ] Verify the agent's response references Tokyo / JST / Asia/Tokyo when discussing the time

#### Agent Reads Recent Activity

- [ ] Uncheck all default activities, then check only "Started the 14-day free trial" and "Invited a teammate"
- [ ] Verify the Published Context JSON shows the new recentActivity array
- [ ] Click the "Suggest next steps" suggestion
- [ ] Verify the agent's response references the trial and/or invited-teammate activities (not the pricing page or demo video)

### 3. Error Handling

- [ ] Clear the Name input to an empty string and ask "What is my name?" — agent should handle gracefully (no crash)
- [ ] Send an empty chat message — input should be rejected without error
- [ ] Verify no console errors during normal usage
- [ ] Verify the agent cannot modify context values (Name / Timezone / Activity checkboxes stay user-controlled)

## Expected Results

- Context card and chat load within 3 seconds
- Agent responds within 10 seconds
- Every change to Name / Timezone / Recent Activity reflects in the Published Context JSON immediately
- Agent responses reflect the CURRENT context values on every turn (no stale context)
- No UI errors or broken layouts
