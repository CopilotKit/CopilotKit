# QA: Shared State (Read + Write) — PydanticAI

## Prerequisites

- Demo is deployed and accessible at `/demos/shared-state-read-write` on the dashboard host
- Agent backend is healthy (`/api/health`); `OPENAI_API_KEY` is set; the PydanticAI agent server is reachable on the configured `AGENT_URL` and the `/shared_state_read_write` sub-path is mounted

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/shared-state-read-write`; verify the page renders within 3s with the left sidebar (preferences + notes cards) and the right-side `CopilotChat` pane
- [ ] Verify `data-testid="preferences-card"` is visible with heading "Your preferences"
- [ ] Verify `data-testid="notes-card"` is visible with heading "Agent notes" and empty-state `data-testid="notes-empty"` reading "No notes yet. Ask the agent to remember something."
- [ ] Verify the chat input placeholder is "Chat with the agent..."
- [ ] Verify all 3 suggestion pills are visible with verbatim titles: "Greet me", "Remember something", "Plan a weekend"
- [ ] Send "Hello" and verify an assistant text response appears within 10s

### 2. Feature-Specific Checks

#### UI Writes -> Agent Reads (preferences via `agent.setState`)

- [ ] Type "Atai" into `data-testid="pref-name"`; verify `data-testid="pref-state-json"` updates to include `"name": "Atai"`
- [ ] Change `data-testid="pref-tone"` to `formal`; verify the JSON preview reflects `"tone": "formal"`
- [ ] Change `data-testid="pref-language"` to `Spanish`; verify the JSON preview reflects `"language": "Spanish"`
- [ ] Click the `Cooking` and `Travel` interest pills; verify both show the selected style and the JSON preview's `interests` array contains both entries
- [ ] Send "What do you know about me?"; verify within 10s the assistant reply references the name "Atai", a formal tone, Spanish, and the Cooking/Travel interests (the dynamic `@agent.system_prompt` injects these into the system prompt each turn)
- [ ] Click the "Plan a weekend" suggestion; verify the reply is tailored to the selected interests

#### Agent Writes -> UI Reads (notes via `set_notes` tool)

- [ ] Click the "Remember something" suggestion (sends "Remember that I prefer morning meetings and that I don't eat dairy.")
- [ ] Within 15s verify `data-testid="notes-list"` appears in the notes card and contains at least 2 `data-testid="note-item"` entries mentioning "morning meetings" and "dairy"
- [ ] Verify `data-testid="notes-empty"` is no longer rendered
- [ ] Send "Also remember I live in Berlin."; verify within 15s the notes list grows (previous notes preserved, new note added) — confirms the agent passes the FULL updated list per `set_notes` contract

#### UI Writes Back to Agent-Authored Slice (clear notes)

- [ ] With notes present, verify `data-testid="notes-clear-button"` is visible
- [ ] Click the Clear button; verify the notes list disappears and `data-testid="notes-empty"` re-renders
- [ ] Ask "What do you remember about me?"; verify the agent no longer cites the cleared notes (state was written back by the UI via `agent.setState({ notes: [] })`)

#### Multi-Turn State Persistence

- [ ] Change tone to `playful` and add the `Music` interest; send "Write me a one-line haiku greeting."; verify the reply is playful and references music
- [ ] Send a follow-up "Do it again in French."; verify the reply remains playful, switches to French, and still acknowledges the music interest — confirms preferences persist across turns without being re-sent
- [ ] Reload the page; verify preferences reset to defaults (`tone: casual`, `language: English`, empty interests, empty name) and notes reset to empty (state is per-session, seeded by the page's `useEffect`)

### 3. Error Handling

- [ ] Attempt to send an empty message; verify it is a no-op (no user bubble, no assistant response)
- [ ] Deselect all interests and clear the name; send "Who am I?"; verify the agent answers without crashing (the dynamic system prompt returns an empty segment when `preferences` is empty)
- [ ] Verify DevTools -> Console shows no uncaught errors during any flow above

## Expected Results

- Page loads within 3 seconds; assistant text response within 10 seconds
- Preferences writes are reflected in `pref-state-json` synchronously on change
- Agent-authored notes appear in `notes-card` within 15 seconds of a "remember" prompt, and the full prior list is preserved on subsequent `set_notes` calls
- Clear button round-trips UI -> agent state and the agent loses access to the cleared notes on the next turn
- No UI layout breaks, no uncaught console errors
