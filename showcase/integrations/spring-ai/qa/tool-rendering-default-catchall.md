# QA: Tool Rendering (Default Catch-all) — Spring AI

## Prerequisites

- Demo is deployed and accessible

## Test Steps

- [ ] Navigate to `/demos/tool-rendering-default-catchall`
- [ ] Ask "What's the weather in San Francisco?"
- [ ] Verify the default tool-call card appears with status Running -> Done
- [ ] Verify Arguments and Result sections populate
- [ ] Try "Find flights from SFO to JFK"
- [ ] Verify another tool card appears with the same default renderer

## Expected Results

- Every backend tool call is painted by the default renderer (no missing tool UI)
