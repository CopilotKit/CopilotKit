# QA: Shared State (Read + Write) — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo deployed and accessible at `/demos/shared-state-read-write`
- Agent backend healthy (`GET /api/copilotkit-shared-state-read-write`)
- `ANTHROPIC_API_KEY` set on the agent backend

## Test Steps

### 1. Page loads

- [ ] Navigate to `/demos/shared-state-read-write`
- [ ] Sidebar renders the **Your preferences** card with empty Name,
      tone = `casual`, language = `English`, no interests selected
- [ ] Sidebar renders the **Agent notes** card showing "No notes yet."
- [ ] Chat panel loads on the right with placeholder
      "Chat with the agent..."
- [ ] Three suggestion chips visible:
      "Greet me", "Remember something", "Plan a weekend"
- [ ] No console errors

### 2. UI -> agent (write) — preferences steer the model

- [ ] Set Name = `Alex`
- [ ] Set Tone = `playful`
- [ ] Pick interests `Cooking` and `Travel`
- [ ] The "Shared state" preview at the bottom of the card updates to
      reflect the new JSON
- [ ] Click the "Greet me" suggestion (or send "Hi, who am I?")
- [ ] Agent response addresses the user as "Alex" and uses a playful
      tone (exclamations, casual phrasing)
- [ ] Agent does NOT use a formal register

### 3. Agent -> UI (read) — set_notes tool writes shared state

- [ ] Send: "Remember that I prefer morning meetings and that I don't
      eat dairy."
- [ ] Within ~10s the **Agent notes** card flips from "No notes yet."
      to a list of 1-3 short bullet items including a morning-meetings
      note and a no-dairy note
- [ ] The notes appear without a page reload (live STATE_SNAPSHOT)
- [ ] Send: "Also, I work in Eastern Time."
- [ ] Notes card now shows the previous notes PLUS a timezone note
      (agent passed the FULL list, not just the new one)

### 4. UI -> agent (write back) — clearing notes

- [ ] Click the **Clear** button on the notes card
- [ ] Notes card returns to "No notes yet."
- [ ] Preferences are unchanged
- [ ] Send: "What do you remember about me?"
- [ ] Agent response references preferences (name, tone) but no notes

### 5. Persistence across turns

- [ ] After clearing, change Tone to `formal` and Language to `Spanish`
- [ ] Send: "Saludos."
- [ ] Agent replies in Spanish using a formal register
- [ ] Send a follow-up; agent still respects the same preferences

### 6. Error handling

- [ ] Send an empty message — handled gracefully (input ignored or no-op)
- [ ] If `ANTHROPIC_API_KEY` is missing on the backend, the chat shows
      an error message via the AG-UI run-error path

## Expected Results

- Preferences edits propagate into agent state on every keystroke /
  toggle (via `agent.setState`)
- Agent's system prompt reflects the latest preferences each turn
- `set_notes` mutations land in the UI within ~1s of the tool call
  ending, via `STATE_SNAPSHOT`
- No full page reloads during the demo
- No console errors in the happy path
