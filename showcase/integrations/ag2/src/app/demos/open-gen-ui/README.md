# Open Generative UI (Minimal)

## What This Demo Shows

The simplest possible Open Generative UI cell. The runtime is
configured with `openGenerativeUI: { agents: ["open-gen-ui"] }` (see
`src/app/api/copilotkit-ogui/route.ts`); the runtime middleware
converts the agent's streamed `generateSandboxedUi` tool call into
`open-generative-ui` activity events, and the built-in
`OpenGenerativeUIActivityRenderer` mounts the agent-authored HTML + CSS
inside a sandboxed iframe.

This cell customises the LLM's design skill via
`openGenerativeUI.designSkill` to bias the agent toward intricate,
educational visualisations (3D axes, neural nets, algorithms, Fourier
series, etc.).

## How to Interact

- "Visualize pitch, yaw, and roll using a 3D model airplane."
- "Animate how a simple feed-forward neural network processes an input."
- "Visualize quicksort on an array of ~10 bars."
- "Visualize how a square wave is built from the sum of odd-harmonic sine waves."

## Technical Details

- Backend agent: `src/agents/open_gen_ui_agent.py` — no tools;
  the frontend-registered `generateSandboxedUi` is auto-merged into the
  agent's tool list at request time.
- Runtime route: `src/app/api/copilotkit-ogui/route.ts` —
  `openGenerativeUI: { agents: [...] }` enables the OGUI middleware.

## Reference

- https://docs.copilotkit.ai/generative-ui/open-generative-ui
