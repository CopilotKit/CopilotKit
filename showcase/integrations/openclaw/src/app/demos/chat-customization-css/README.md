# Chat Customization (CSS)

## What This Demo Shows

How to restyle the built-in `CopilotChat` purely with CSS — no component
overrides. Every visual choice lives in a scoped stylesheet, so the contrast
against the default look comes entirely from CSS.

- **Scoped Theming**: All styles are scoped to a `.chat-css-demo-scope` wrapper,
  so the theme can't leak into other cells
- **Built-In Classes**: The stylesheet targets CopilotKit's built-in class names
- **Attachments Enabled**: The chat is configured with attachments on

## How to Interact

Chat normally — the point is the look, not new behavior. Compare the styling
against the default `agentic-chat` surface.

## Technical Details

**Provider** — `CopilotKit` with `runtimeUrl="/api/copilotkit"` (proxying via an
`HttpAgent` to the clawg-ui AG-UI operator route on the OpenClaw gateway) and
`agent="chat-customization-css"`.

**Theming** — `import "./theme.css"` applies the scoped stylesheet; the page
markup stays minimal. The chat is a `CopilotChat` with
`attachments={{ enabled: true }}`. This is a pure frontend-presentation
variation over the same OpenClaw event stream as `agentic-chat`.
