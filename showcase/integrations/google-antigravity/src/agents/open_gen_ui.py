"""Open Generative UI: the model designs a sandboxed UI through a frontend tool.

``generateSandboxedUi`` is not declared here. The runtime's
``openGenerativeUI`` config makes the provider register it as a frontend
tool, and the adapter turns every ``RunAgentInput.tools`` entry into an
Antigravity tool, so the model sees it like any other. The frontend
handler answers ``"UI generated"`` with a follow-up run, which resolves the
parked call; the runtime's OpenGenerativeUIMiddleware turns the call's
arguments into the ``open-generative-ui`` activity the page renders.

The page also sends a "design skill" as agent context. Antigravity fixes the
instructions per session, so the context is not folded into the prompt; the
instructions below tell the model to read it with the adapter's built-in
``get_app_context`` tool (see PARITY_NOTES.md, "Shared state and agent
context").
"""

from agents._common import build

# langgraph-python's open_gen_ui_agent.py prompt, plus the get_app_context read.
SYSTEM_PROMPT = """You are a UI-generating assistant for an Open Generative UI demo
focused on intricate, educational visualisations (3D axes / rotations,
neural-network activations, sorting-algorithm walkthroughs, Fourier
series, wave interference, planetary orbits, etc.).

On every user turn you MUST call the `generateSandboxedUi` frontend tool
exactly once. Design a visually polished, self-contained HTML + CSS +
SVG widget that *teaches* the requested concept.

The frontend provides a detailed "design skill" as app context describing
the palette, typography, labelling, and motion conventions expected. Call
`get_app_context` before designing to read it, then follow it closely. Key
invariants:
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


def open_gen_ui_agent():
    return build(system_instructions=SYSTEM_PROMPT, experimental_app_context=True)
