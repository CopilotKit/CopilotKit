# Open Generative UI

## What This Demo Shows

Open-ended UI generation — the agent designs and streams a self-contained HTML + CSS + SVG visualisation into a sandboxed iframe in the chat.

## How to Interact

Try asking your Copilot to:

- "Visualise pitch, yaw, and roll using a 3D model airplane."
- "Animate how a simple feed-forward neural network processes an input."
- "Show quicksort running on ~10 bars of varying heights."
- "Visualise a Fourier square wave built from odd-harmonic sines."

The agent produces one `generateSandboxedUi` tool call per turn; the runtime streams its HTML + CSS and mounts the output inside an isolated iframe in the chat.

## Technical Details

- **`openGenerativeUI: true`** on the CopilotKit runtime enables the Open Generative UI pipeline for the listed agent (`open-gen-ui`). See `src/app/api/copilotkit-ogui/route.ts`.
- The provider auto-registers the `generateSandboxedUi` frontend tool, which the runtime forwards to the MS Agent Framework agent via AG-UI on every turn.
- The agent is a thin wrapper around the MS Agent Framework `Agent` with a system prompt tuned for visual, educational output. See `src/agents/open_gen_ui_agent.py`.
- When the LLM calls `generateSandboxedUi`, the runtime's `OpenGenerativeUIMiddleware` converts the streaming tool call into `open-generative-ui` activity events.
- The built-in `OpenGenerativeUIActivityRenderer` mounts the streamed HTML + CSS inside a `sandbox="allow-scripts"` iframe.
- This demo has **no** host-side sandbox functions — the visualisation is self-running. For the interactive sandbox-function variant, see the `open-gen-ui-advanced` demo.

The `openGenerativeUI.designSkill` prop on the provider swaps in a visualisation-tuned design skill in place of the default shadcn guidance, biasing the LLM toward crisp, labelled SVG scenes.
