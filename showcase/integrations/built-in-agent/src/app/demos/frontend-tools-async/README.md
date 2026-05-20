# Frontend Tools (Async)

Same `useFrontendTool` pattern as `frontend-tools`, but the handler is
async and awaits a simulated client-side DB round-trip (500ms). Once it
resolves, the result is passed back to the agent and rendered through a
branded `NotesCard`.

## Files

- `page.tsx` — registers `query_notes` (async handler + render)
- `notes-card.tsx` — `NotesCard` component used by the per-tool render

## Backend

Reuses `createBuiltInAgent` (TanStack AI + `openaiText("gpt-4o")`) at
`src/app/api/copilotkit/route.ts`. No backend changes — frontend tools
live entirely in the browser; the agent only sees their schema.
