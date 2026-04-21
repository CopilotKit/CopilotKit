"""Minimal LangGraph agent for the Open-Ended Generative UI demo.

The simplest possible example that exercises the open-ended generative UI
pipeline. All the interesting work happens outside the agent:

- `CopilotKitMiddleware` merges the frontend-registered `generateSandboxedUi`
  tool (auto-registered by `CopilotKitProvider` when the runtime has
  `openGenerativeUI` enabled) into the agent's tool list. The LLM then sees
  the tool via the normal AG-UI flow.
- When the LLM calls `generateSandboxedUi`, the runtime's
  `OpenGenerativeUIMiddleware` (enabled via `openGenerativeUI` on the
  runtime — see `src/app/api/copilotkit-ogui/route.ts`) converts that
  streaming tool call into `open-generative-ui` activity events that the
  built-in renderer mounts inside a sandboxed iframe.

This is the minimal variant: no sandbox functions, no app-side tools. The
agent simply asks the LLM to design and emit a single-shot sandboxed UI.
The "advanced" sibling (`open_gen_ui_advanced_agent.py`) builds on this
with sandbox-to-host function calling via `openGenerativeUI.sandboxFunctions`.
"""

from __future__ import annotations

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI

SYSTEM_PROMPT = """You are a UI-generating assistant for an Open Generative UI demo
focused on intricate, educational visualisations (3D axes / rotations,
neural-network activations, sorting-algorithm walkthroughs, Fourier
series, wave interference, planetary orbits, etc.).

On every user turn you MUST call the `generateSandboxedUi` frontend tool
exactly once. Design a visually polished, self-contained HTML + CSS +
SVG widget that *teaches* the requested concept.

The frontend injects a detailed "design skill" as agent context
describing the palette, typography, labelling, and motion conventions
expected — follow it closely. Key invariants:
- Use inline SVG (or <canvas>) for geometric content, not stacks of <div>s.
- Every axis is labelled; every colour-coded series has a legend.
- Prefer CSS @keyframes / transitions over setInterval; loop cyclical
  concepts with animation-iteration-count: infinite.
- Motion must teach — animate the actual step of the concept, not decoration.
- No fetch / XHR / localStorage — the sandbox has no same-origin access.

Output order:
- `initialHeight` (typically 480-560 for visualisations) first.
- A short `placeholderMessages` array (2-3 lines describing the build).
- `css` (complete).
- `html` (streams live — keep it tidy). CDN <script> tags for Chart.js /
  D3 / etc. go inside the html.

Keep your own chat message brief (1 sentence) — the real output is the
rendered visualisation.
"""

graph = create_agent(
    model=ChatOpenAI(model="gpt-4.1", model_kwargs={"parallel_tool_calls": False}),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
