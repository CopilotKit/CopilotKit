# QA: Headless Chat (Complete) — Spring AI

## Prerequisites

- Spring AI backend is up

## Test Steps

- [ ] Navigate to `/demos/headless-complete`
- [ ] Send "Hi"
- [ ] Verify distinct user/assistant bubbles render (hand-rolled, not CopilotChat)
- [ ] Ask "What's the weather in Tokyo?"
- [ ] Verify the WeatherCard renders via the hand-rolled tool-call renderer
- [ ] Press the stop button during a long reply — verify the agent halts

## Expected Results

- Chat is built entirely on `useAgent` + low-level render hooks
- MCP-driven activity rendering is a no-op on Spring; tool + A2UI renderers still compose
