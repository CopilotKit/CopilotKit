# QA: Tool Rendering (Default Catch-all) — Agno

## Prerequisites

- Demo deployed at `/demos/tool-rendering-default-catchall`
- Agent backend healthy

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/tool-rendering-default-catchall`
- [ ] Verify chat renders with placeholder "Type a message"
- [ ] Verify "Weather in SF", "Find flights", "Roll a d20" pills render

### 2. Feature-Specific Checks

- [ ] Click "Weather in SF"; verify a default tool-call card is rendered showing the tool name `get_weather`
- [ ] Click "Roll a d20"; verify a tool-call card appears for `roll_dice`

### 3. Error Handling

- [ ] No uncaught console errors
