# QA: Shared State (Read + Write) — AG2

## Prerequisites

- Demo is deployed and accessible at `/demos/shared-state-read-write`
- Agent backend is healthy (check `/api/copilotkit` GET → `agent_status: reachable`)
- Backend has `OPENAI_API_KEY` set
- The `shared-state-read-write` agent is mounted at `/shared-state-read-write` on
  the FastAPI server (see `src/agent_server.py`)

## Test Steps

### 1. Page renders with the two cards and chat

- [ ] Navigate to `/demos/shared-state-read-write`
- [ ] Sidebar shows the **Preferences** card (`data-testid="preferences-card"`)
- [ ] Sidebar shows the **Agent notes** card (`data-testid="notes-card"`) with the
      empty state copy "No notes yet. Ask the agent to remember something."
- [ ] Right-hand pane shows `<CopilotChat />` with the placeholder
      "Chat with the agent..."
- [ ] The "Shared state" panel inside the preferences card shows JSON with
      `name: ""`, `tone: "casual"`, `language: "English"`, `interests: []`

### 2. UI -> agent (write)

- [ ] Type a name (e.g. `Atai`) into the **Name** input. The "Shared state"
      JSON inside the card updates immediately to reflect the new name.
- [ ] Change **Tone** to `playful`. JSON updates.
- [ ] Change **Language** to `Spanish`. JSON updates.
- [ ] Toggle 2-3 interests (e.g. `Cooking`, `Tech`). JSON updates and the
      buttons show the selected style.
- [ ] In the chat, send: **"Greet me in one sentence."**
- [ ] The agent's reply addresses the user by name in a playful tone, in
      Spanish (i.e. it actually used the preferences). It must NOT just
      echo the JSON.

### 3. agent -> UI (read)

- [ ] In the chat, send: **"Remember that I prefer morning meetings and that
      I don't eat dairy."**
- [ ] The **Agent notes** card transitions from the empty state to a
      bulleted list with at least 2 entries (`data-testid="note-item"`),
      reflecting the two facts above. The list updates in real time
      while/after the agent finishes its turn.
- [ ] In the chat, send: **"Also remember I work in Pacific time."**
- [ ] The notes list now has at least 3 entries (the agent passed the FULL
      list to `set_notes`, not just the new one).

### 4. Round-trip + Clear

- [ ] Click the **Clear** button on the notes card.
- [ ] The notes card returns to the empty state immediately.
- [ ] In the chat, send: **"What do you remember about me?"**
- [ ] The agent reports it has no remembered notes (because the UI cleared
      them via `agent.setState`), confirming the UI's write-back was
      visible to the agent on its next turn.

### 5. Error handling

- [ ] Send an empty message → handled gracefully (no crash, no broken UI).
- [ ] No console errors during normal usage.

## Expected Results

- Page loads in < 3 seconds.
- Preferences edits propagate to agent state instantly.
- Agent replies adapt visibly to preferences (name, tone, language).
- Notes card reflects every `set_notes` call from the agent.
- Clearing notes from the UI is reflected on the agent's next turn.
