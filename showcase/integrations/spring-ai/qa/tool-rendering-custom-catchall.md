# QA: Tool Rendering (Custom Catch-all) — Spring AI

## Prerequisites

- Demo is deployed and accessible

## Test Steps

- [ ] Navigate to `/demos/tool-rendering-custom-catchall`
- [ ] Ask "What's the weather in San Francisco?"
- [ ] Verify the branded custom catch-all card appears (`data-testid="custom-catchall-card"`)
- [ ] Verify the card includes tool name, status badge, Arguments and Result sections
- [ ] Try "Find flights from SFO to JFK" and verify the same branded card paints

## Expected Results

- All tool calls render via the custom catch-all component
