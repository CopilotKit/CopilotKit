"""Open Generative UI: the model designs a sandboxed UI through a frontend tool.

``generateSandboxedUi`` is not declared here. The runtime's
``openGenerativeUI`` config makes the provider register it as a frontend
tool, and the adapter turns every ``RunAgentInput.tools`` entry into a
``FunctionTool`` proxy, so the model sees it like any other tool. The
frontend handler answers ``"UI generated"`` with a follow-up run; the
runtime's OpenGenerativeUIMiddleware turns the call's arguments into the
``open-generative-ui`` activity the page renders.

The page also sends a "design skill" as agent context, which the adapter
appends to the instructions.
"""

from agents import Agent

from demo_agents._common import MODEL

# langgraph-python's open_gen_ui_agent.py prompt.
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


open_gen_ui_agent = Agent(
    name="open_gen_ui_assistant",
    instructions=SYSTEM_PROMPT,
    model=MODEL,
)
