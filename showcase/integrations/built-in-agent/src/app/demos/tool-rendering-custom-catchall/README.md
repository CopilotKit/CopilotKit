# Tool Rendering — Custom Catch-all

Mid-step in the tool-rendering progression: opt out of the built-in
default card and register a SINGLE custom wildcard renderer via
`useDefaultRenderTool({ render })`. The same branded card now paints
every tool call — no per-tool renderers yet.

## Files

- `page.tsx` — registers the wildcard renderer
- `custom-catchall-renderer.tsx` — branded `CustomCatchallRenderer`
  with status pill, args block, and result block

## Backend

Reuses the default route at `src/app/api/copilotkit/route.ts` (TanStack
AI + `openaiText("gpt-4o")`). The mock tools (`get_weather`,
`search_flights`, `get_stock_price`, `roll_dice`) are defined in
`src/lib/factory/server-tools.ts`.
