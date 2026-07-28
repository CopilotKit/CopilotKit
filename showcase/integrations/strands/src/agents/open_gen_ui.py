"""Dedicated Strands agent for the Open-Ended Generative UI demo (minimal).

All heavy lifting happens outside this agent:

- The CopilotKit runtime is configured with `openGenerativeUI` for this
  agent (see `src/app/api/copilotkit-ogui/route.ts`). The provider
  auto-registers the `generateSandboxedUi` frontend tool, which the
  runtime forwards via the AG-UI protocol on each turn.
- When the LLM calls `generateSandboxedUi`, the runtime's
  `OpenGenerativeUIMiddleware` converts that streaming tool call into
  `open-generative-ui` activity events that the built-in renderer mounts
  inside a sandboxed iframe.

This is the minimal variant: no sandbox functions, no app-side tools.
The agent system prompt forces exactly one `generateSandboxedUi` call per
turn so the LGP-identical (less imperative) frontend design skill still
produces a sandboxed UI. The advanced sibling is
`open_gen_ui_advanced_agent.py`.
"""

from __future__ import annotations

from textwrap import dedent

from strands import Agent
from ag_ui_strands import StrandsAgent

from agents.agent import _build_model

SYSTEM_PROMPT = dedent(
    """
    You are a UI-generating assistant for an Open Generative UI demo
    focused on intricate, educational visualisations (3D axes / rotations,
    neural-network activations, sorting-algorithm walkthroughs, Fourier
    series, wave interference, planetary orbits, etc.).

    On every user turn you MUST call the `generateSandboxedUi` frontend
    tool exactly once. Design a visually polished, self-contained
    HTML + CSS + SVG widget that *teaches* the requested concept.

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

# Back-compat alias for any importer that still uses the old name.
OPEN_GEN_UI_SYSTEM_PROMPT = SYSTEM_PROMPT


def build_open_gen_ui_agent() -> StrandsAgent:
    """Construct the minimal Open Generative UI StrandsAgent.

    `generateSandboxedUi` is frontend-injected via openGenerativeUI
    middleware — tools stay empty on the backend agent.
    """
    strands_agent = Agent(
        model=_build_model(),
        system_prompt=SYSTEM_PROMPT,
        tools=[],
    )

    return StrandsAgent(
        agent=strands_agent,
        name="open_gen_ui",
        description=(
            "Generates self-contained, educational sandboxed UI "
            "(HTML + CSS + SVG) via the `generateSandboxedUi` frontend tool."
        ),
    )


__all__ = [
    "SYSTEM_PROMPT",
    "OPEN_GEN_UI_SYSTEM_PROMPT",
    "build_open_gen_ui_agent",
]
