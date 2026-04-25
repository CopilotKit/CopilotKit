"""PydanticAI agent for the Open-Ended Generative UI demo.

Mirrors showcase/packages/langgraph-python/src/agents/open_gen_ui_agent.py
as closely as PydanticAI's `agent.to_ag_ui()` surface allows.

The agent is ultra-minimal on purpose: all the heavy lifting happens in
the runtime layer. When the `openGenerativeUI` runtime flag is enabled
(see src/app/api/copilotkit-ogui/route.ts), the runtime injects a
frontend-registered `generateSandboxedUi` tool into the agent's tool
list and converts its streamed tool call into `open-generative-ui`
activity events for the built-in sandboxed-iframe renderer.

This module exports an `agent` instance that `agent_server.py` can mount
alongside the main sales agent. The frontend targets it via the
`open-gen-ui` agent id.
"""

from __future__ import annotations

from textwrap import dedent

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIResponsesModel


SYSTEM_PROMPT = dedent(
    """
    You are a UI-generating assistant for an Open Generative UI demo
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
).strip()


agent = Agent(
    model=OpenAIResponsesModel("gpt-4.1"),
    system_prompt=SYSTEM_PROMPT,
)
