# Parity Notes

Baseline: `showcase/packages/langgraph-python/`.

The Claude Agent SDK (TypeScript) backend is a single pass-through
`agent_server.ts` that forwards AG-UI tool schemas (frontend-registered +
runtime-injected) directly to Claude via the Anthropic Messages API.
Demos whose LangGraph reference depends on primitives the pass-through
does not implement are skipped below.

## Skipped demos

- `beautiful-chat` — flagship cell that composes A2UI (dynamic + fixed schema), OpenGenerativeUI, and MCP Apps through a single combined runtime alongside agent-authored tools; porting requires dedicated Claude agent branches for each feature, not a single pass-through.
- `headless-complete` — multi-component chat surface assumes backend-authored tools (`get_weather`, `highlight_note`, `display_stock`) defined in the LangGraph `headless_complete` graph; the pass-through has no equivalent agent.
- `a2ui-fixed-schema` — relies on the backend graph's `display_flight` tool emitting an `a2ui_operations` container via `a2ui.render(...)`; the pass-through agent cannot synthesise that backend-defined tool.
- `tool-rendering-default-catchall` — requires the backend `tool_rendering` graph's mock tools (`get_weather`, `search_flights`, `get_stock_price`, `roll_dice`) so the frontend can render them with zero custom renderers; no equivalent toolset exists on the pass-through.
- `tool-rendering-custom-catchall` — same blocker as `tool-rendering-default-catchall` (backend-authored tool suite).
- `gen-ui-interrupt` — requires LangGraph's `interrupt()` primitive and the `on_interrupt` custom event; Claude Agent SDK and the pass-through have no equivalent.
- `interrupt-headless` — same LangGraph `interrupt()` dependency as `gen-ui-interrupt`.
- `agentic-chat-reasoning` — requires per-token reasoning/thinking stream events on AG-UI; the pass-through does not currently forward Claude extended-thinking blocks as AG-UI reasoning events.
- `reasoning-default-render` — same thinking-stream dependency as `agentic-chat-reasoning`.
- `tool-rendering-reasoning-chain` — same thinking-stream dependency as `agentic-chat-reasoning`.
