# QA: Agentic Chat (Reasoning) — Mastra

## Test Steps

- [ ] Navigate to `/demos/agentic-chat-reasoning`
- [ ] Ask a question that could trigger reasoning (e.g. "Explain the Monty Hall problem step by step")
- [ ] If the underlying model emits reasoning tokens, verify the ReasoningBlock (`data-testid="reasoning-block"`) renders with an amber banner

## Expected Results

- The `reasoningMessage` slot override is active
- Reasoning content streams italic under an amber "Reasoning" label

## Known Limitation

The Mastra weather agent is not guaranteed to emit REASONING_MESSAGE_* AG-UI events by default. This demo exists primarily to exercise the slot-override path; on models without reasoning output the ReasoningBlock will simply not render and the chat falls back to normal assistant messages.
