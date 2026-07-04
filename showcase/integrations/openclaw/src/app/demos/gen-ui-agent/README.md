# Agentic Generative UI

## What This Demo Shows

How to render rich, generative UI directly from an OpenClaw agent's tool call.
The agent calls a single structured tool, `generate_recipe`, and the frontend
renders its arguments as a branded recipe card — the agent decides WHAT to
render (by choosing the tool and its arguments), and the frontend owns HOW it
looks.

- **Per-Tool Renderer**: A single `useRenderTool` renderer keyed by the
  `generate_recipe` tool name paints a `RecipeCard`
- **Renders From Arguments**: The card paints from the streamed tool arguments,
  so the rich UI appears on the FIRST tool call — no tool-result round-trip
  needed
- **Self-Contained**: The card component, its types, and its styling are all
  inlined in this cell

## How to Interact

Ask the agent for a recipe, then watch the recipe card render inline in the
chat. For example:

- "Generate a quick weeknight pasta recipe."
- "Generate a hearty vegan breakfast recipe."

## Technical Details

**Provider** — `CopilotKit` with `runtimeUrl="/api/copilotkit"` (proxying via an
`HttpAgent` to the clawg-ui AG-UI operator route on the OpenClaw gateway) and
`agent="gen-ui-agent"`.

**Per-tool renderer** — `useRenderTool` registers a renderer for the
`generate_recipe` tool. clawg-ui streams `TOOL_CALL_START` / `_ARGS` / `_END`
over AG-UI, and `CopilotChat` drives the `RecipeCard` through its
`inProgress` → `executing` → `complete` lifecycle.
