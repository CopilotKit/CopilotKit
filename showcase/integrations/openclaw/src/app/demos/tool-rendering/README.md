# Tool Rendering

## What This Demo Shows

How to render the OpenClaw agent's server-side tool calls in the chat. OpenClaw
exposes generic server tools (shell exec, read, etc.) rather than a fixed,
known set, so instead of a branded per-tool renderer this cell registers a
single wildcard renderer that paints ANY tool call as a tidy card.

- **Generic Catch-All**: One `useDefaultRenderTool` renderer handles every tool
  the agent invokes
- **Live Lifecycle**: Each card moves through `inProgress` → `executing` →
  `complete` as the tool streams
- **Full Detail**: The card shows the tool name, a status badge, the arguments
  as JSON, and the result

## How to Interact

Ask the agent to do something that requires its server tools, then watch the
tool cards appear inline in the chat. For example:

- "List the files in the current directory"
- "Read the first few lines of package.json"

## Technical Details

**Provider** — `CopilotKit` with `runtimeUrl="/api/copilotkit"` (proxying via an
`HttpAgent` to the clawg-ui AG-UI operator route on the OpenClaw gateway) and
`agent="tool-rendering"`.

**Catch-all renderer** — `useDefaultRenderTool` registers a wildcard renderer.
clawg-ui streams `TOOL_CALL_START` / `_ARGS` / `_RESULT` / `_END` over AG-UI,
and `CopilotChat` drives the `CustomCatchallRenderer` card through its lifecycle.
