# Frontend Tools

Defines a tool entirely in the React tree via `useFrontendTool`. The
agent sees the schema (forwarded over AG-UI), invokes it, and the
handler runs in the browser to mutate page state — here, the page
background.

## Files

- `page.tsx` — registers `change_background` and reflects the result in
  local state.

## Backend

Reuses `createBuiltInAgent` (TanStack AI + `openaiText("gpt-4o")`) at
`src/app/api/copilotkit/route.ts`. No backend changes — frontend tools
are entirely in-browser, advertised to the agent via the chat input
contract.
