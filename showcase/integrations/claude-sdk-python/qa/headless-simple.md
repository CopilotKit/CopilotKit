# QA: Headless Chat (Simple) — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/headless-simple`
- [ ] Verify the heading "Headless Chat (Simple)" is visible
- [ ] Verify the placeholder text "No messages yet. Say hi!" is displayed
- [ ] Type a message into the textarea
- [ ] Click Send (or press Enter)
- [ ] Verify the user bubble appears immediately on the right
- [ ] Verify the agent responds with a text bubble on the left

### 2. Feature-Specific Checks

#### useAgent / useComponent

- [ ] Ask "Show me a card about cats"
- [ ] Verify the ShowCard component renders with a title and body

#### Running state

- [ ] While the agent is replying, verify "Agent is thinking..." appears below the message list
- [ ] Verify the Send button is disabled while the agent is running

### 3. Error Handling

- [ ] Verify sending an empty message does nothing
- [ ] Verify no console errors during normal usage

## Expected Results

- Page loads within 3 seconds
- Agent responds within 10 seconds
- ShowCard renders when the agent calls `show_card`
