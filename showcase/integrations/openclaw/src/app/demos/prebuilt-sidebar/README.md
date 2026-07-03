# Prebuilt Sidebar

## What This Demo Shows

The pre-built `CopilotSidebar` component — a docked chat panel that ships as a
drop-in surface over the OpenClaw agent.

- **Docked Layout**: The sidebar docks to the edge of the viewport and pushes
  the page's content instead of overlapping it
- **Zero Custom UI**: The chat surface is entirely the prebuilt component
- **Suggestion Chips**: Starter suggestions are registered for the sidebar

## How to Interact

The sidebar opens by default. Toggle it with the launcher to see the layout
shift, then chat or click a suggestion.

## Technical Details

**Provider** — `CopilotKit` with `runtimeUrl="/api/copilotkit"` (proxying via an
`HttpAgent` to the clawg-ui AG-UI operator route on the OpenClaw gateway) and
`agent="prebuilt-sidebar"`.

**Sidebar** — `<CopilotSidebar agentId="prebuilt-sidebar" defaultOpen />`
renders the full docked chat UI. This is a pure frontend-presentation variation
over the same OpenClaw event stream as `agentic-chat`.
