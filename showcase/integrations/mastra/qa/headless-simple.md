# QA: Headless Chat (Simple) — Mastra

## Test Steps

- [ ] Navigate to `/demos/headless-simple`
- [ ] Verify the custom minimal chat UI renders (not `<CopilotChat />`)
- [ ] Type a message, press Enter; verify it appears as a user bubble
- [ ] Verify the agent responds with an assistant bubble
- [ ] Ask "show a card about cats"
- [ ] Verify the ShowCard component renders inside the assistant message area

## Expected Results

- `useAgent` + `useComponent` driven from a plain textarea
- Tool calls rendered via `useRenderToolCall`
