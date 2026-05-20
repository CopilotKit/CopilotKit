# QA: Agentic Chat (Reasoning) — Agno

## Prerequisites

- Demo deployed at `/demos/agentic-chat-reasoning`
- Agno agent backend healthy with the `reasoning_agent` module loaded
  (served at `/reasoning/agui`)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/agentic-chat-reasoning`
- [ ] Send "Explain why the sky is blue in two short steps"
- [ ] Verify a custom amber reasoning card (`data-testid="reasoning-block"`)
      appears BEFORE the final assistant answer
- [ ] Verify the reasoning card shows a "Reasoning" pill and streamed thinking
      content

### 2. Feature-Specific Checks

- [ ] While the agent is running, the reasoning card shows "Thinking…"
- [ ] After the run completes, the reasoning card shows "Agent reasoning"
- [ ] The reasoning content is italic / visually distinct from the answer

### 3. Error Handling

- [ ] No uncaught console errors
