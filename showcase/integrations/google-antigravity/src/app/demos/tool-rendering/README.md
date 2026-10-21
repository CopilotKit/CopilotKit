# Tool Rendering

Backend tool calls from `tool_rendering_agent()` (`src/agents/tool_rendering.py`
— `get_weather`, `search_flights`, `get_stock_price`, `roll_d20`) are rendered
as React components in the chat transcript. The frontend uses `useRenderTool`
to register a renderer per tool name, receiving `args`, `result`, and `status`
so the UI can reflect both in-flight and completed calls, plus
`useDefaultRenderTool` as a wildcard catch-all for anything without a
dedicated renderer.

The tools are passed straight to `AntigravityAgent(tools=[...])`; the adapter
introspects their Python signatures for the JSON Schema, dispatches each call
itself, and emits `TOOL_CALL_RESULT` with the real return value — the model
only has to emit the call and narrate, the same mechanism the reference
integration uses for its backend tools.

The canonical description lives in the showcase manifest; this README is just
a developer note alongside the demo source.
