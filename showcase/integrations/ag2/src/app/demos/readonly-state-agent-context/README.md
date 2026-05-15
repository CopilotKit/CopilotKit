# Readonly State (Agent Context)

## What This Demo Shows

The frontend publishes read-only context to the agent via `useAgentContext`. The agent reads it on every turn but cannot modify it — the reverse direction of writable shared state.

- **Three context entries**: user name, IANA timezone, and a list of recent in-app activities
- **Live edits**: changing the sidebar form updates the published context immediately; the next agent reply reflects it
- **No tools, no custom state**: this is the minimal shape of `useAgentContext` — the agent just reads what the frontend registered

## How to Interact

Edit the context in the sidebar (name, timezone, recent activity), then try:

- "What do you know about me from my context?"
- "Based on my recent activity, what should I try next?"
- "What time is it in my timezone and what should I do for the next hour?"

The agent answers using only the context the UI published.

## Technical Details

- Three `useAgentContext({ description, value })` calls on the page publish `userName`, `userTimezone`, and `recentActivity` as labeled entries. Each re-publishes automatically when its React state changes.
- On the backend (`src/agents/readonly_state_agent_context.py`), the agent declares `tools=[]` and relies on `CopilotKitMiddleware` to route the context entries into the model's message history each turn.
- The system prompt tells the model to consult the context when relevant (address the user by name, respect their timezone, reference recent activity) and keep replies short.
- Wired with `runtimeUrl="/api/copilotkit"` and `agent="readonly-state-agent-context"`; the chat surface is a plain `CopilotChat` next to the sidebar form.
