# QA: Shared State (Read + Write) — Google Antigravity

## Prerequisites

- Demo is deployed and accessible at `/demos/shared-state-read-write` on the dashboard host
- Agent backend is healthy (`/api/health` or `/api/copilotkit` GET); `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set (the Go harness calls Gemini itself; `GOOGLE_GEMINI_BASE_URL` points it at aimock in tests)
- The agent server (`src/agent_server.py`) mounts `shared-state-read-write` at `/shared-state-read-write`, bound in `src/agents/registry.py` to `shared_state_read_write_agent()` from `src/agents/shared_state.py`; the page talks to it through `/api/copilotkit`
- How state moves:
  - UI → agent: the page writes `preferences` with `agent.setState()`. The agent's instructions tell the model to call the adapter's silent built-in `get_shared_state` tool (opted into with `experimental_app_state=True`) before every answer; it emits no TOOL_CALL events.
  - Agent → UI: the `set_notes(notes)` server tool replaces the `notes` slot with the adapter's `experimental_set_state()`, which streams a `STATE_SNAPSHOT`, so the notes card updates while the turn runs.

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/shared-state-read-write`; verify the page renders within 3s with heading "Shared state — read & write", the preferences and notes cards in the main column, and the `CopilotSidebar` open by default (the cards sit side by side at `xl` / 1280px and wider, and stack below that)
- [ ] Verify `data-testid="preferences-card"` is visible with heading "Your preferences"
- [ ] Verify `data-testid="notes-card"` is visible with heading "Agent Scratch pad" and empty state `data-testid="notes-empty"` reading "the agent will make observations about you and note them here!"
- [ ] Verify the chat input placeholder is "Chat with the agent..."
- [ ] Verify all 3 suggestion pills are visible with verbatim titles: "Greet me", "Remember something", "Plan a weekend"
- [ ] Send "Hello" and verify an assistant text response appears within 10s

### 2. Feature-Specific Checks

#### UI Writes → Agent Reads (preferences via `agent.setState`)

- [ ] Verify `data-testid="pref-state-json"` initially shows `"name": ""`, `"tone": "casual"`, `"language": "English"` and an empty `interests` array
- [ ] Type "Atai" into `data-testid="pref-name"`; verify the JSON preview updates to include `"name": "Atai"`
- [ ] Change `data-testid="pref-tone"` to Formal; verify the JSON preview shows `"tone": "formal"`
- [ ] Change `data-testid="pref-language"` to Spanish; verify the JSON preview shows `"language": "Spanish"`
- [ ] Click the "Cooking" and "Travel" interest badges; verify both show the selected style and the JSON preview's `interests` array contains both
- [ ] Send "What do you know about me?"; verify within 10s the reply uses the name "Atai", a formal tone, Spanish, and mentions the Cooking/Travel interests (the model read them through `get_shared_state`)
- [ ] Verify no tool-call card appears for the state read
- [ ] Click "Plan a weekend"; verify the reply is tailored to the selected interests

#### Agent Writes → UI Reads (notes via `set_notes`)

- [ ] Click "Remember something" (sends "Remember that I prefer morning meetings and that I don't eat dairy.")
- [ ] Within 15s verify `data-testid="notes-list"` appears and contains at least 2 `data-testid="note-item"` entries mentioning "morning meetings" and "dairy", each numbered 01, 02…
- [ ] Verify `data-testid="notes-empty"` is no longer rendered
- [ ] Send "Also remember I live in Berlin."; verify within 15s the list grows with the earlier notes still present (the tool takes the FULL updated list)

#### UI Writes Back to the Agent-Authored Slice (clear notes)

- [ ] With notes present, verify `data-testid="notes-clear-button"` ("Clear") is visible
- [ ] Click Clear; verify the list disappears and `data-testid="notes-empty"` renders again
- [ ] Ask "What do you remember about me?"; verify the agent no longer cites the cleared notes (the UI wrote `notes: []` with `agent.setState`, and the model re-reads state before answering)

#### Multi-Turn State

- [ ] Change tone to Playful and add the "Music" interest; send "Write me a one-line haiku greeting."; verify the reply is playful and references music
- [ ] Send "Do it again in French."; verify the reply stays playful, switches to French, and still acknowledges music
- [ ] Reload the page; verify preferences reset to the defaults and the notes card is empty again (the page seeds state on mount)

### 3. Error Handling

- [ ] Attempt to send an empty message; verify it is a no-op (no user bubble, no assistant response)
- [ ] Deselect all interests and clear the name; send "Who am I?"; verify the agent answers without crashing
- [ ] Verify DevTools → Console shows no uncaught errors during any flow above

## Expected Results

- Page loads within 3 seconds; assistant text response within 10 seconds
- Preference edits show up in `pref-state-json` as soon as they are made
- Agent-authored notes appear in `notes-card` within 15 seconds of a "remember" prompt, and earlier notes are kept on later `set_notes` calls
- Clear round-trips UI → agent state, and the agent stops citing the cleared notes on the next turn
- No UI layout breaks, no uncaught console errors
