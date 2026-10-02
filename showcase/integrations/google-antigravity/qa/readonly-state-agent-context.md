# QA: Read-Only Agent Context — Google Antigravity

## Prerequisites

- Demo is deployed and accessible at `/demos/readonly-state-agent-context` on the dashboard host
- Agent backend is healthy (`/api/health` or `/api/copilotkit` GET); `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set (the Go harness calls Gemini itself; `GOOGLE_GEMINI_BASE_URL` points it at aimock in tests)
- The agent server (`src/agent_server.py`) mounts `readonly-state-agent-context` at `/readonly-state-agent-context`, bound in `src/agents/registry.py` to `app_context_agent()` from `src/agents/app_context.py`; the page talks to it through `/api/copilotkit`
- How the agent sees the context: the page publishes three `useAgentContext` entries (display name, IANA timezone, recent activity), which reach the agent as `RunAgentInput.context`. The agent's instructions tell the model to call the adapter's silent built-in `get_app_context` tool (opted into with `experimental_app_context=True`) before every answer; it returns `[{description, value}]` and emits no TOOL_CALL events, so no card appears in the chat. The agent has no tool that could write the values back.

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/readonly-state-agent-context`
- [ ] Verify the heading "Agent Context Inspector" with the "Read-only Agent Context" and "useAgentContext" badges
- [ ] Verify the context grid is visible (`data-testid="context-card"`) with the "Identity", "Recent Activity" and "Published Context" cards
- [ ] Verify the chat renders as a `CopilotPopup`, open by default, with placeholder "Ask about your context..."
- [ ] Send "Hello" via the popup and verify the agent responds with a text message

### 2. Feature-Specific Checks

#### Initial Context State

- [ ] Verify the Name input (`data-testid="ctx-name"`) defaults to "Atai", and the avatar (`data-testid="identity-avatar"`) shows "A" with `data-testid="identity-name"` reading "Atai"
- [ ] Verify the Timezone select (`data-testid="ctx-timezone"`) defaults to "America/Los_Angeles" and offers: America/Los_Angeles, America/New_York, Europe/London, Europe/Berlin, Asia/Tokyo, Australia/Sydney
- [ ] Verify the Recent Activity options: "Viewed the pricing page", "Added 'Pro Plan' to cart", "Watched the product demo video", "Started the 14-day free trial", "Invited a teammate"
- [ ] Verify two are checked by default — "Viewed the pricing page" (`data-testid="activity-viewed-the-pricing-page"`) and "Watched the product demo video" (`data-testid="activity-watched-the-product-demo-video"`) — and the card badge reads "2 selected"
- [ ] Verify `data-testid="ctx-state-json"` shows `{ "name": "Atai", "timezone": "America/Los_Angeles", "recentActivity": [...] }`

#### Suggestions

- [ ] Verify "Who am I?" suggestion is visible
- [ ] Verify "Suggest next steps" suggestion is visible
- [ ] Verify "Plan my morning" suggestion is visible

#### Agent Reads User Name

- [ ] Click "Who am I?" (sends "What do you know about me from my context?")
- [ ] Verify the reply addresses the user as "Atai" and mentions the default activities
- [ ] Verify no tool-call card appears for the context read
- [ ] Change the Name input to "Jamie"; verify `ctx-state-json` shows `"name": "Jamie"`
- [ ] Ask "What is my name?"; verify the reply says "Jamie" (not "Atai")

#### Agent Reads Timezone

- [ ] Change the Timezone select to "Asia/Tokyo"; verify `ctx-state-json` shows `"timezone": "Asia/Tokyo"` and `data-testid="identity-timezone"` updates
- [ ] Click "Plan my morning"; verify the reply references Tokyo / JST / Asia/Tokyo

#### Agent Reads Recent Activity

- [ ] Uncheck both default activities, then check only "Started the 14-day free trial" and "Invited a teammate"
- [ ] Verify `ctx-state-json` shows the new `recentActivity` array and each checked card reads "Visible to the agent"
- [ ] Click "Suggest next steps"; verify the reply references the trial and/or the invited teammate, not the pricing page or demo video

### 3. Error Handling

- [ ] Clear the Name input and ask "What is my name?"; verify the agent answers gracefully (no crash); the avatar shows "?" and the name shows "Anonymous"
- [ ] Send an empty chat message; verify it is rejected without error
- [ ] Verify no console errors during normal usage
- [ ] Verify the agent never changes the Name, Timezone or Activity values (they stay user-controlled)

## Expected Results

- Context cards and popup load within 3 seconds
- Agent responds within 10 seconds
- Every change to Name / Timezone / Recent Activity shows up in `ctx-state-json` immediately
- Replies reflect the CURRENT context values on every turn (the model re-reads them with `get_app_context`)
- No UI errors or broken layouts
