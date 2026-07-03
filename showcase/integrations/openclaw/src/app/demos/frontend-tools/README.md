# Frontend Tools

## What This Demo Shows

A tool that is DEFINED in the React tree, EXECUTED in the browser, and INVOKED
by the OpenClaw agent. Here the `change_background` tool restyles the page's
background from chat.

- **Browser-Side Execution**: The tool handler runs locally in the page, not on
  the server
- **Agent-Invoked**: The model decides when to call it, based on the user's
  request
- **Live Effect**: Calling the tool immediately transitions the page background

## How to Interact

Open the sidebar chat and ask the agent to change the background:

- "Make the background a warm sunset gradient"
- "Set the background to solid teal"

## Technical Details

**Provider** — `CopilotKit` with `runtimeUrl="/api/copilotkit"` (proxying via an
`HttpAgent` to the clawg-ui AG-UI operator route on the OpenClaw gateway) and
`agent="frontend-tools"`. The chat is a `CopilotSidebar`.

**Frontend tool** — `useFrontendTool` registers `change_background` with a Zod
schema. The schema is forwarded over AG-UI in `RunAgentInput.tools`; the clawg-ui
adapter hands it to OpenClaw as a caller-provided `clientTool`. When the model
calls it, the run stops with a pending tool call, clawg-ui emits `TOOL_CALL_*`
events, and the page's `handler` runs locally to update React state.
