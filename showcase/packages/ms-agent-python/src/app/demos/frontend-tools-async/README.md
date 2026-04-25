# Frontend Tools (Async Handler)

## What This Demo Shows

`useFrontendTool` handlers can be async. This cell exercises the full async path: the agent calls a client-registered tool, the handler awaits a simulated client-side notes-DB query (500ms), returns the matches, and the agent summarizes the result.

## How to Interact

Try asking:

- "Find my notes about project planning"
- "Search my notes for anything related to auth"
- "Do I have any notes tagged reading?"

While the query is running the per-tool render shows a loading card; once the handler resolves the card re-renders with the matched notes.

## Technical Details

The frontend tool's `handler` is `async` and awaits a simulated round-trip before returning results:

```tsx
useFrontendTool({
  name: "query_notes",
  parameters: z.object({ keyword: z.string() }),
  handler: async ({ keyword }) => {
    await sleep(500); // simulated client-side DB latency
    const matches = NOTES_DB.filter(...).slice(0, 5);
    return { keyword, count: matches.length, notes: matches };
  },
  render: ({ args, result, status }) => <NotesCard ... />,
});
```

- The Microsoft Agent Framework agent receives the tool schema via AG-UI and decides when to call it.
- While `status !== "complete"`, the render shows a loading state.
- When the handler resolves, the agent receives the result and produces a natural-language summary.
- No backend tool is involved — the data lives and is queried entirely in the browser.
