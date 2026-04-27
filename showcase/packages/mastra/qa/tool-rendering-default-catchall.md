# QA: Tool Rendering (Default Catch-all) — Mastra

## Test Steps

- [ ] Navigate to `/demos/tool-rendering-default-catchall`
- [ ] Ask "What's the weather in San Francisco?"
- [ ] Verify the default tool-call card renders (package-provided `DefaultToolCallRenderer`)
- [ ] Verify the tool name, status pill, and arguments/result sections are visible

## Expected Results

- No custom renderer code is required in the page
- Every tool call uses the default UI
