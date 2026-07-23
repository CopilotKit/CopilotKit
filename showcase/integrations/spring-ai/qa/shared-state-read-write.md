# QA: Shared State (Read + Write) — Spring AI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check `/api/health`)
- `OPENAI_API_KEY` is set on the Spring backend

## Architecture under test

- The UI owns a `preferences = { name, tone, language, interests }` object
  and writes it into agent state via `agent.setState({ preferences, notes })`.
- Spring's `SharedStateReadWriteController` runs a per-request `LocalAgent`
  subclass that reads `preferences` off the AG-UI envelope and injects them
  into the system prompt every turn.
- The agent has a single tool, `set_notes(notes: List<String>)`, that
  mutates `state.notes` and emits a `STATE_SNAPSHOT` event so the
  `useAgent({ updates: [OnStateChanged] })` hook re-renders the page.

## Test Steps

### 1. Page load

- [ ] Navigate to `/demos/shared-state-read-write`.
- [ ] Verify both sidebar cards render: `data-testid="preferences-card"` and
      `data-testid="notes-card"`.
- [ ] Verify the chat input is visible on the right.
- [ ] Confirm the preferences JSON pre block (`data-testid="pref-state-json"`)
      shows the seeded defaults: `{ name: "", tone: "casual", language:
"English", interests: [] }`.

### 2. Write side (UI -> agent)

- [ ] Type "Atai" into `data-testid="pref-name"`.
- [ ] Switch tone to "playful" via `data-testid="pref-tone"`.
- [ ] Switch language to "Spanish" via `data-testid="pref-language"`.
- [ ] Click two interest chips (e.g. "Cooking", "Music").
- [ ] Confirm the JSON pre block updates live to reflect every edit.
- [ ] Send the message "Greet me." and verify the assistant's reply:
  - addresses the user as "Atai",
  - is in Spanish,
  - has a playful tone (exclamations / light humor OK),
  - and references at least one selected interest if natural.

### 3. Read side (agent -> UI)

- [ ] Send: "Remember that I prefer morning meetings and that I don't eat
      dairy."
- [ ] Verify the agent calls `set_notes` (visible briefly in the chat
      stream) and that the Notes card shows two list items shortly after.
- [ ] Verify `data-testid="notes-list"` is present and contains two
      `data-testid="note-item"` entries.
- [ ] Send another remember-style message: "Also remember I'm vegetarian."
- [ ] Verify the notes list grows (the agent should pass the FULL list,
      not a diff), now showing three items.

### 4. Bidirectional clear

- [ ] Click `data-testid="notes-clear-button"` in the Notes card.
- [ ] Verify the list is cleared and `data-testid="notes-empty"` appears.
- [ ] Send "What did I tell you to remember?" — agent should not hallucinate
      removed notes (memory persists in chat history but the notes panel
      is canonical).

### 5. Error handling

- [ ] Send an empty message — UI should handle gracefully.
- [ ] Disconnect briefly: verify reconnect does not corrupt state.
- [ ] No console errors during normal usage.

## Expected Results

- Page loads within 3 seconds.
- Preferences edits show in the JSON pre block instantly (local state).
- Agent replies adapt to preferences within 10 seconds.
- Notes panel reflects `set_notes` calls within 1 second after the tool
  result event lands (driven by the STATE_SNAPSHOT emission).
- No UI errors, no orphaned state across renders.
