# QA: Agent Config Object — Mastra

## Test Steps

- [ ] Navigate to `/demos/agent-config`
- [ ] Verify the ConfigCard is rendered with tone, expertise, responseLength controls
- [ ] Set tone = "playful", expertise = "beginner", responseLength = "short"
- [ ] Ask "Explain TCP"
- [ ] Verify the response is short and playful-beginner tone

## Expected Results

- Config forwarded via `useAgentContext`; agent adapts

## Mastra-specific note

The LangGraph reference uses runtime `properties` passed to a dedicated route. Mastra's Memory primitive doesn't forward these in the same way, so this port uses `useAgentContext` — functionally equivalent from the user's perspective but a different wiring pattern.
