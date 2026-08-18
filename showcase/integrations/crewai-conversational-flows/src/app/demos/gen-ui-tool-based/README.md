# Tool-Based Generative UI

The agent calls a backend tool that returns structured data; the frontend
renders that tool result as a custom React component instead of plain text.

`useRenderTool` maps each tool name to a renderer that receives `args`,
`result`, and `status`, so the UI can show loading and complete states.

The canonical description lives in the showcase manifest; this README is just
a developer note alongside the demo source.
