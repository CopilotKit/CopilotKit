# QA: Shared State (Read + Write) — CrewAI Conversational Flows

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (`/api/health`)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/shared-state-read-write`; verify the preferences and scratch-pad cards render and the chat sidebar opens by default
- [ ] Verify `data-testid="preferences-card"` is visible with heading "Your preferences"
- [ ] Verify `data-testid="notes-card"` is visible with heading "Agent Scratch pad"
- [ ] Verify `data-testid="notes-empty"` reads "the agent will make observations about you and note them here!"
- [ ] Verify the chat input placeholder is "Chat with the agent..."
- [ ] Verify the suggestions "Greet me", "Remember something", and "Plan a weekend" are visible
- [ ] Send "Hello" and verify an assistant response appears

### 2. Feature-Specific Checks

#### UI Writes -> Agent Reads

- [ ] Enter "Atai" in `data-testid="pref-name"`; set tone to `formal`, language to `Spanish`, and select `Cooking` and `Travel`
- [ ] Verify `data-testid="pref-state-json"` immediately reflects all four preference changes
- [ ] Send "What do you know about me?" and verify the response uses the name, tone, language, and interests supplied through shared state

#### Agent Writes -> UI Reads

- [ ] Click "Remember something"
- [ ] Verify `data-testid="notes-list"` appears and contains `data-testid="note-item"` entries for morning meetings and dairy
- [ ] Send "Also remember I live in Berlin." and verify the notes list preserves the previous entries and adds Berlin

#### UI Writes Back to Agent State

- [ ] Click `data-testid="notes-clear-button"`; verify the list disappears and `data-testid="notes-empty"` returns
- [ ] Ask "What do you remember about me?" and verify the cleared notes are no longer cited

### 3. Error Handling

- [ ] Attempt to send an empty message; verify it is a no-op
- [ ] Clear the name and deselect all interests; verify a subsequent turn completes without an error
- [ ] Verify the browser console has no uncaught errors during the flow

## Expected Results

- UI preference edits reach the conversational flow on the next turn
- Flow-authored notes appear in shared state and preserve prior entries
- Clearing notes round-trips from the UI back to flow state
- No UI errors or broken layouts
