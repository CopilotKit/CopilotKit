# QA: Reasoning (Default) — Claude Agent SDK (Python)

> Stub — authored for column completeness. This demo verifies the
> built-in `CopilotChatReasoningMessage` renders without a custom slot
> and does not warrant a full manual checklist.

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy; `ANTHROPIC_API_KEY` set. The cell uses the shared
  `/api/copilotkit` runtime with agent `reasoning-default`, mapped to the
  FastAPI `POST /reasoning` endpoint (`src/agents/reasoning_agent.py`), which
  emits AG-UI `REASONING_MESSAGE_*` events

## Test Steps

- [ ] Navigate to /demos/reasoning-default
- [ ] Click the "Show reasoning" suggestion pill (prompt: "Explain step by step why the sky appears blue during the day but red at sunset.") and verify the built-in `CopilotChatReasoningMessage` collapsible card renders the reasoning tokens
- [ ] Verify no custom reasoning slot is wired (default styling only — no `ReasoningBlock` or bespoke container; `page.tsx` passes no `messageView.reasoningMessage`)

## Expected Results

- Page loads without errors
- Reasoning renders via CopilotKit's default `CopilotChatReasoningMessage` component with zero frontend configuration
