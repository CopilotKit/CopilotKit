# Prebuilt Popup

## What This Demo Shows

The pre-built `CopilotPopup` component — a floating launcher and overlay chat
that ships as a drop-in surface over the OpenClaw agent.

- **Floating Overlay**: A launcher bubble sits in the corner and opens an
  overlay chat; the page layout keeps its shape underneath
- **Zero Custom UI**: The chat surface is entirely the prebuilt component
- **Suggestion Chips**: Starter suggestions are registered for the popup

## How to Interact

The popup opens by default. Close and re-open it with the launcher bubble, then
chat or click a suggestion.

## Technical Details

**Provider** — `CopilotKit` with `runtimeUrl="/api/copilotkit"` (proxying via an
`HttpAgent` to the clawg-ui AG-UI operator route on the OpenClaw gateway) and
`agent="prebuilt-popup"`.

**Popup** — `<CopilotPopup agentId="prebuilt-popup" defaultOpen />` renders the
floating launcher and overlay chat; `labels.chatInputPlaceholder` customizes the
input placeholder. This is a pure frontend-presentation variation over the same
OpenClaw event stream as `agentic-chat`.
