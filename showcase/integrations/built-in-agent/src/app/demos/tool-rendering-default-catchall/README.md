# Tool Rendering — Default Catch-all

The simplest tool-rendering setup: the frontend calls
`useDefaultRenderTool()` with **no config** so every tool call falls
through to CopilotKit's built-in `DefaultToolCallRenderer` (status pill +
collapsible Arguments / Result).

## Files

- `page.tsx` — single page; calls `useDefaultRenderTool()` with no args.

## Backend

Reuses the default route at `src/app/api/copilotkit/route.ts`, wired to
`createBuiltInAgent` in `src/lib/factory/tanstack-factory.ts`. The mock
tools (`get_weather`, `search_flights`, `get_stock_price`, `roll_dice`)
live in `src/lib/factory/server-tools.ts`.
