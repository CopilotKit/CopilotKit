# Tool Rendering

Backend agent tool calls are rendered as React components in the chat
transcript. The frontend uses `useRenderTool` to register a renderer per tool
name, receiving `args`, `result`, and `status` so the UI can reflect both
in-flight and completed calls.

The canonical description lives in the showcase manifest; this README is just
a developer note alongside the demo source.
