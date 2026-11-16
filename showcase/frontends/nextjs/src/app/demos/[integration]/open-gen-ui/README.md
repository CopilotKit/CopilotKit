# Open Generative UI

## What This Demo Shows

For each answer, the agent writes a small HTML, CSS and SVG app, and the chat shows it in a sandboxed iframe. This page asks for educational visualisations that animate on their own.

## How to Interact

Click a suggestion, or ask for any visualisation. For example:

- "3D axis visualization (model airplane)"
- "How a neural network works"
- "Quicksort visualization"
- "Fourier: square wave from sines"

## Technical Details

- The runtime options of this demo turn on Open Generative UI for the `open-gen-ui` agent (see `src/demo-runtime-options.ts`). The runtime middleware turns the `generateSandboxedUi` tool call of the agent into `open-generative-ui` activity events.
- `CopilotKitProvider` registers the built-in `OpenGenerativeUIActivityRenderer`. It mounts the generated HTML and CSS in an `<iframe sandbox="allow-scripts">`, so a plain `<CopilotChat />` is enough.
- `openGenerativeUI.designSkill` on the provider replaces the default design guidance with `VISUALIZATION_DESIGN_SKILL` from `design-skill.ts`.
- `page.tsx` is a server component. It loads the settings of the integration for this demo, and gives them to the client component in `demo.tsx`.
- Some agents have no system prompt that makes them call `generateSandboxedUi`. Their integration sets `instructToolCall: true` in `src/integrations/<slug>/demos/open-gen-ui.ts`. The page then puts `TOOL_CALL_INSTRUCTION` in front of the design skill.

For a generated UI that calls functions on the host page, see the `open-gen-ui-advanced` demo.

Reference: https://docs.copilotkit.ai/generative-ui/open-generative-ui
