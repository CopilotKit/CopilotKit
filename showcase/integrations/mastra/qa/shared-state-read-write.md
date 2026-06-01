# QA: Shared State (Read + Write) — Mastra

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the shared-state-read-write demo page
- [ ] Verify the preferences card loads (`data-testid="preferences-card"`)
- [ ] Verify the notes card loads (`data-testid="notes-card"`)
- [ ] Verify the empty notes message renders (`data-testid="notes-empty"`):
      "No notes yet. Ask the agent to remember something."
- [ ] Verify the chat panel is visible with placeholder
      "Chat with the agent..."
- [ ] Send a basic message (e.g. "Say hi.") and verify the agent responds.

### 2. UI -> Agent (Write) — preferences

- [ ] Type a name into the Name input (`data-testid="pref-name"`).
- [ ] Verify the JSON state preview (`data-testid="pref-state-json"`)
      reflects the new name.
- [ ] Change the Tone select (`data-testid="pref-tone"`) to "playful".
- [ ] Change the Language select (`data-testid="pref-language"`) to
      "Spanish".
- [ ] Toggle two interests (e.g. "Cooking", "Travel"). Verify both
      buttons render in the selected style.
- [ ] Verify the JSON state preview now reads:
      `{ "name": "...", "tone": "playful", "language": "Spanish",
"interests": ["Cooking", "Travel"] }`
- [ ] Send a message: "Greet me, then suggest a quick recipe." Verify
      the agent: - addresses the user by the name from preferences - replies in Spanish - uses a playful tone - leans on the Cooking interest

### 3. Agent -> UI (Read) — notes

- [ ] Click the "Remember something" suggestion. The chat sends the
      message: "Remember that I prefer morning meetings and that I
      don't eat dairy."
- [ ] Verify the agent calls the `set_notes` tool.
- [ ] Verify the notes card switches from the empty state to a
      bulleted list (`data-testid="notes-list"` with one or more
      `data-testid="note-item"` entries).
- [ ] Verify each note is < ~120 chars and each preference the user
      mentioned is reflected.
- [ ] Send another message: "Also remember that I like long walks."
      Verify the notes list grows (existing notes preserved + the new
      one).

### 4. UI -> Agent (Write back) — clear notes

- [ ] Click the "Clear" button (`data-testid="notes-clear-button"`).
- [ ] Verify the notes list disappears and the empty state reappears.
- [ ] Send a follow-up: "What did I tell you to remember?". Verify the
      agent acknowledges the empty notes state (it may re-populate
      notes if it remembers from chat history — this is acceptable).

### 5. Suggestions

- [ ] Verify "Greet me", "Remember something", and "Plan a weekend"
      suggestion buttons are visible.

### 6. Error Handling

- [ ] Send an empty message — should be ignored or handled gracefully.
- [ ] Verify no console errors during normal usage.

## Expected Results

- Preferences and notes cards load within 3 seconds.
- Agent replies within 10 seconds for simple turns.
- Preferences edits propagate into agent state (JSON preview updates
  instantly, agent reply on next turn reflects them).
- `set_notes` tool calls visibly populate the notes card without a
  page refresh.
- The Clear button removes notes from agent state, surfaced via the
  empty state.
- No UI errors or broken layouts.
