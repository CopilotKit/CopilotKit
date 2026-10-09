# QA: Reasoning (Default) — Google Antigravity

## Prerequisites

- Demo is deployed and accessible at `/demos/reasoning-default` on the dashboard host
- Agent backend is healthy (`/api/health` or `/api/copilotkit` GET); `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set (the Go harness calls Gemini itself; `GOOGLE_GEMINI_BASE_URL` points it at aimock in tests)
- The agent server (`src/agent_server.py`) mounts `reasoning-default` at `/reasoning-default`, bound in `src/agents/registry.py` to `reasoning_agent()` from `src/agents/reasoning.py` (shared with `reasoning-custom`; model from `ANTIGRAVITY_REASONING_MODEL`); the page talks to it through `/api/copilotkit`
- How reasoning reaches the chat: the harness turns Gemini thought parts into thinking steps, and the adapter emits `REASONING_START`, `REASONING_MESSAGE_START` / `CONTENT` / `END` and `REASONING_END`. In fixture runs aimock replays the fixture's `reasoning` field as thought parts (`aimock/d6/google-antigravity/reasoning.json`). Against real Gemini, a reasoning message appears only when the model returns thought parts for that turn.
- This page renders `<CopilotChat />` with NO slot override, so reasoning uses CopilotKit's built-in `CopilotChatReasoningMessage`

## Test Steps

- [ ] Navigate to `/demos/reasoning-default`; verify the chat loads in a centered full-height layout
- [ ] Verify one suggestion pill, "Show reasoning", is visible
- [ ] Click "Show reasoning" (sends "Explain step by step why the sky appears blue during the day but red at sunset.")
- [ ] Verify the built-in reasoning card appears above the answer with a "Thinking…" header while tokens stream, then a "Thought for …" header once done
- [ ] Expand the reasoning card; verify it contains the reasoning text
- [ ] Verify the final answer renders as ordinary assistant text below the reasoning card
- [ ] Verify no custom reasoning slot is wired (default styling only — no `data-testid="reasoning-block"` banner)
- [ ] Verify DevTools → Console shows no uncaught errors or AG-UI event-verification errors

## Expected Results

- Page loads without errors
- Reasoning streams into CopilotKit's default `CopilotChatReasoningMessage` with zero frontend configuration
- The reasoning text is shown in the reasoning card, not repeated as assistant text
