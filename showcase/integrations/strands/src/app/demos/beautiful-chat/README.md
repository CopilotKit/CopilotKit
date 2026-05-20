# Beautiful Chat (Strands)

## What This Demo Shows

A polished, landing-style CopilotChat surface with brand theming and seeded
suggestions, sitting on top of the shared Strands agent. It is the
"show me a great-looking starter chat" cell.

## How to Interact

The page seeds suggestion pills you can click directly:

- "Plan a 3-day Tokyo trip"
- "Explain RAG like I'm 12"
- "Show me weather in Tokyo" (renders a weather card via the shared agent)
- "Draft a launch email"

You can also type any prompt — the chat behaves like the agentic-chat
demo, just inside a more polished shell.

## Technical Details

- The page wraps `<CopilotChat />` in a brand-themed gradient container
  with rounded glass panel, header, and seeded suggestions via
  `useConfigureSuggestions`.
- It points at the shared `/api/copilotkit` runtime and the shared Strands
  agent (`agent="beautiful-chat"` is registered in
  `src/app/api/copilotkit/route.ts`).
- All cosmetic styling lives on the frontend; no backend changes are
  required.

## Simplified Port — What Is Out Of Scope

The canonical langgraph-python `beautiful-chat` cell ships a much larger
surface: an `ExampleCanvas`, a generative-UI examples board, a multi-tool
declarative A2UI catalog, theme provider, and a dedicated runtime that
combines `openGenerativeUI` + `a2ui` + `mcpApps` simultaneously. That
ecosystem depends on dozens of starter-level sub-components.

This Strands port mirrors the simplified pattern shipped by
`showcase/integrations/spring-ai/src/app/demos/beautiful-chat/` — a
brand-themed chat shell over the shared agent. Porting the full canvas /
A2UI catalog is tracked as future work in
`showcase/integrations/strands/PARITY_NOTES.md`.

For the full reference surface see
`showcase/integrations/langgraph-python/src/app/demos/beautiful-chat/`.
