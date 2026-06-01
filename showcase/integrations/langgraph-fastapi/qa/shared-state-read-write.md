# QA: Shared State (Read + Write) — LangGraph (FastAPI)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check `/api/copilotkit` GET — `agent_status: "reachable"`)
- `OPENAI_API_KEY` is set in the agent environment

## What this demo proves

- **UI -> agent (write)**: editing the preferences card writes the new
  `preferences` object straight into agent state via `agent.setState`.
- **agent -> UI (read)**: when the agent invokes its `set_notes` tool the
  `notes` slice of agent state updates and the Notes card re-renders.
- **agent -> reads UI writes**: a `PreferencesInjectorMiddleware` reads
  `preferences` out of state every turn and prepends it to the system
  prompt, so the next reply visibly adapts.

## Test Steps

### 1. Page loads with both cards

- [ ] Navigate to `/demos/shared-state-read-write`
- [ ] The Preferences card (`data-testid="preferences-card"`) is visible
- [ ] The Notes card (`data-testid="notes-card"`) is visible
- [ ] The Notes card shows "No notes yet" (`data-testid="notes-empty"`)
- [ ] The chat input on the right is visible

### 2. UI writes flow into agent state (preferences)

- [ ] Type a name into `pref-name` (e.g. "Atai") — the JSON in
      `pref-state-json` updates immediately
- [ ] Change tone to "playful" via `pref-tone` — JSON reflects it
- [ ] Change language to "Spanish" via `pref-language` — JSON reflects it
- [ ] Click two interest pills (e.g. Cooking, Music) — JSON `interests` array updates

### 3. Agent reads the UI-written preferences

- [ ] In chat, send "Say hi and introduce yourself."
- [ ] The agent reply addresses the user by the name from the card
- [ ] The reply tone matches the selected tone
- [ ] If language was changed (e.g. Spanish), the reply is in that language

### 4. Agent writes notes via `set_notes`

- [ ] Send: "Remember that I prefer morning meetings and that I don't eat dairy."
- [ ] Within ~10 seconds, the Notes card transitions away from `notes-empty`
- [ ] At least one `note-item` appears with each remembered fact
- [ ] Subsequent unrelated chat turns leave the notes intact

### 5. UI can clear agent-written state

- [ ] With at least one note showing, click `notes-clear-button`
- [ ] The Notes card returns to `notes-empty` immediately
- [ ] No errors in the browser console

### 6. Error handling

- [ ] Sending an empty message is handled gracefully (no crash)
- [ ] Refreshing the page resets state to defaults; first turn re-seeds it

## Expected Results

- Chat loads within 3 seconds
- Each preference edit reflects in `pref-state-json` immediately
- Note updates land within 10 seconds of asking the agent to remember
- No UI errors or broken layouts; no React warnings in console
