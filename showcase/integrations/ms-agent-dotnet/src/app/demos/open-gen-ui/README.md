# Open-Ended Generative UI

## What This Demo Shows

A .NET-backed agent that streams on-the-fly HTML + CSS + SVG visualisations into a sandboxed iframe inside the chat.

## How to Interact

Try one of the preset suggestions (3D axes, neural network, quicksort, Fourier series) or ask for any educational visualisation. The agent generates a self-running, animated widget for every turn.

## Technical Details

- **Agent**: `OpenGenUiAgentFactory` (see `agent/OpenGenUiAgent.cs`) — a `ChatClientAgent` whose system prompt constrains the LLM to call the `generateSandboxedUi` frontend tool exactly once per turn. No backend tools are registered.
- **Frontend tool**: `generateSandboxedUi` is auto-registered by `CopilotKitProvider` when the runtime has `openGenerativeUI` enabled and is merged into the agent's tool list by the AG-UI protocol.
- **Runtime route**: `src/app/api/copilotkit-ogui/route.ts` turns on Open Generative UI via `openGenerativeUI: { agents: [...] }`. The runtime's `OpenGenerativeUIMiddleware` converts the streamed `generateSandboxedUi` tool call into `open-generative-ui` activity events.
- **Renderer**: The built-in `OpenGenerativeUIActivityRenderer` mounts the streamed HTML + CSS inside a sandboxed `<iframe sandbox="allow-scripts">`.
- **Design skill**: This page overrides the default shadcn-flavoured design skill with `VISUALIZATION_DESIGN_SKILL` (see `page.tsx`) to steer the LLM toward educational visualisations.

## Building With This

For an advanced variant that lets the generated UI invoke host-page functions (calculator, notifyHost, etc.), see `open-gen-ui-advanced`.

Reference: https://docs.copilotkit.ai/generative-ui/open-generative-ui
