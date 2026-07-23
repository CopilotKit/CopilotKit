"""Claude Agent SDK backing the Open-Ended Generative UI (minimal) demo.

The simplest possible example that exercises the open-ended generative UI
pipeline. All the interesting work happens outside the agent:

- CopilotKit merges the frontend-registered `generateSandboxedUi` tool
  (auto-registered by `CopilotKitProvider` when the runtime has
  `openGenerativeUI` enabled) into the agent's tool list. The LLM then
  sees the tool via the normal AG-UI flow.
- When the LLM calls `generateSandboxedUi`, the runtime's
  `OpenGenerativeUIMiddleware` (enabled via `openGenerativeUI` on the
  runtime — see `src/app/api/copilotkit-ogui/route.ts`) converts that
  streaming tool call into `open-generative-ui` activity events that the
  built-in renderer mounts inside a sandboxed iframe.

This is the minimal variant: no sandbox functions, no app-side tools.
The shared Claude backend in `src/agents/agent.py` handles this demo
via the `open-gen-ui` agent name registered in the ogui route. This
module exists so the manifest's `highlight` path references a per-demo
Python reference, mirroring the langgraph-python layout.
"""

SYSTEM_PROMPT_HINT = (
    "You are a UI-generating assistant for an Open Generative UI demo "
    "focused on intricate, educational visualisations. On every user "
    "turn you MUST call the `generateSandboxedUi` frontend tool exactly "
    "once. Design a visually polished, self-contained HTML + CSS + SVG "
    "widget that teaches the requested concept. Use inline SVG (or "
    "<canvas>) for geometric content — no stacks of <div>s. Keep your "
    "own chat message brief (1 sentence); the rendered visualisation is "
    "the real output."
)
