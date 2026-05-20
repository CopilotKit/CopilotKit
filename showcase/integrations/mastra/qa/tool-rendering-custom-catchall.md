# QA: Tool Rendering (Custom Catch-all) — Mastra

## Test Steps

- [ ] Navigate to `/demos/tool-rendering-custom-catchall`
- [ ] Ask "Weather in SF" then "Find flights from SFO to JFK"
- [ ] Verify each tool call renders the `CustomCatchallRenderer` card (`data-testid="custom-catchall-card"`)
- [ ] Verify `data-tool-name` attribute matches the invoked tool

## Expected Results

- Every tool call is painted with the same branded wildcard card
