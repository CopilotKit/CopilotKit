# Headless Chat (Complete)

## What This Demo Shows

A fully headless chat surface composed by hand from `useAgent` — no
`<CopilotChat />`, no `<CopilotChatMessageView />`, no
`<CopilotChatAssistantMessage />`. The cell exercises the full
generative-UI rendering stack: text, per-tool renderers, and a
frontend-only component tool.

## How to Interact

- "What's the weather in Tokyo?" — backend `get_weather` tool, rendered
  via a per-tool `useRenderTool` weather card.
- "What's AAPL trading at?" — backend `get_stock_price` tool, rendered
  via a per-tool `useRenderTool` stock card.
- "Highlight 'meeting at 3pm' in yellow." — frontend `highlight_note`
  tool registered via `useComponent`.

## Technical Details

- Backend agent: `src/agent/headless-complete-prompt.ts` plus the
  `/headless-complete` route in `src/agent_server.ts` — defines the two
  backend tools and a system prompt that routes user questions to the
  right surface.
- Frontend chrome (`page.tsx`, `message-list.tsx`,
  `use-rendered-messages.tsx`, …) is hand-rolled — every assistant
  bubble, tool-call card, and frontend-component renderer is composed
  manually from CopilotKit hooks.
- Runtime route: `src/app/api/copilotkit-headless-complete/route.ts`.
