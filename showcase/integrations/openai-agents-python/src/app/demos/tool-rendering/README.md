# Tool Rendering

Backend tool calls from `tool_rendering_agent()` (`src/demo_agents/tool_rendering.py`
— `get_weather`, `search_flights`, `get_stock_price`, `roll_d20`) are rendered
as React components in the chat transcript. The frontend uses `useRenderTool`
to register a renderer per tool name, receiving `args`, `result`, and `status`
so the UI can reflect both in-flight and completed calls, plus
`useDefaultRenderTool` as a wildcard catch-all for anything without a
dedicated renderer.

The tools are ordinary Agents SDK `@function_tool`s; the SDK runs each call
and the adapter streams it as `TOOL_CALL_START/ARGS/END` followed by
`TOOL_CALL_RESULT` with the real return value — the model only has to emit
the call and narrate, the same mechanism the reference integration uses for
its backend tools.

The canonical description lives in the showcase manifest; this README is just
a developer note alongside the demo source.
