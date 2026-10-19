# QA: Reasoning (Custom) — Google Antigravity

## Prerequisites

- Demo is deployed and accessible at `/demos/reasoning-custom` on the dashboard host
- Agent backend is healthy (`/api/health` or `/api/copilotkit` GET); `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set (the Go harness calls Gemini itself; `GOOGLE_GEMINI_BASE_URL` points it at aimock in tests)
- The agent server (`src/agent_server.py`) mounts `reasoning-custom` at `/reasoning-custom`, bound in `src/agents/registry.py` to `reasoning_agent()` from `src/agents/reasoning.py` (shared with `reasoning-default`; model from `ANTIGRAVITY_REASONING_MODEL`); the page talks to it through `/api/copilotkit`
- How reasoning reaches the chat: the harness turns Gemini thought parts into thinking steps, and the adapter emits `REASONING_START`, `REASONING_MESSAGE_START` / `CONTENT` / `END` and `REASONING_END`. In fixture runs aimock replays the fixture's `reasoning` field as thought parts (`aimock/d6/google-antigravity/reasoning.json`, shared with `reasoning-default`). Against real Gemini, a reasoning message appears only when the model returns thought parts for that turn.
- This page overrides `messageView.reasoningMessage` with `ReasoningBlock` (`src/app/demos/reasoning-custom/reasoning-block.tsx`)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/reasoning-custom`; verify the chat loads in a centered full-height layout (max-width 4xl)
- [ ] Verify one suggestion pill, "Show reasoning", is visible
- [ ] Send "Hello" and verify the agent responds

### 2. Feature-Specific Checks

#### Custom Reasoning Block

- [ ] Click "Show reasoning" (sends "Explain step by step why the sky appears blue during the day but red at sunset.")
- [ ] Verify a `data-testid="reasoning-block"` element appears above the answer: a rounded card with a light indigo tint and a small uppercase "Reasoning" pill
- [ ] While the reasoning streams, verify the header text next to the pill reads "Thinking…"
- [ ] After it finishes, verify the header reads "Agent reasoning" and the reasoning text is shown inline in italic muted text (not collapsed)
- [ ] Verify the final answer renders as ordinary assistant text below the block
- [ ] Verify the built-in `CopilotChatReasoningMessage` ("Thought for …" collapsible) does NOT render — the slot override replaces it

#### Compare With the Default Cell

- [ ] Open `/demos/reasoning-default` in another tab and send the same pill
- [ ] Verify the same agent produces reasoning in both cells; only the rendering differs

#### Multi-Turn

- [ ] Send a second concrete question (e.g. "If a train leaves at 3pm going 60 mph, when has it covered 150 miles?")
- [ ] Verify a new `reasoning-block` mounts for the second turn and the first turn's block keeps its content

### 3. Error Handling

- [ ] Send an empty message (should be a no-op)
- [ ] Verify DevTools → Console shows no uncaught errors or AG-UI event-verification errors

## Expected Results

- Chat loads within 3 seconds; reasoning starts streaming within 10 seconds
- Reasoning renders in the custom `ReasoningBlock` (tagged "Reasoning" pill, "Thinking…" then "Agent reasoning", inline italic text)
- The reasoning text is not duplicated into the assistant answer
- No UI errors or broken layouts
