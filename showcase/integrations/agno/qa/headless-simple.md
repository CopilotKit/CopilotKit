# QA: Headless Chat (Simple) — Agno

## Prerequisites

- Demo deployed at `/demos/headless-simple`
- Agent backend healthy

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/headless-simple`
- [ ] Verify the heading "Headless Chat (Simple)" is visible
- [ ] Verify the textarea + "Send" button render

### 2. Feature-Specific Checks

- [ ] Type "Say hi" and click Send
- [ ] Verify the user bubble appears followed by an assistant text bubble
- [ ] Ask "show a card about cats"
- [ ] Verify a `ShowCard` renders in the transcript (title + body)

### 3. Error Handling

- [ ] Empty input disables the Send button
- [ ] Shift+Enter does not submit
- [ ] No uncaught console errors
