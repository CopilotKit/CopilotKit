"""AG2 agent for the Open-Ended Generative UI (minimal) demo.

The agent has no tools. The frontend-registered `generateSandboxedUi`
tool (auto-registered by `CopilotKitProvider` when the runtime has
`openGenerativeUI` enabled) is merged into the agent's tool list at
request time by the AG-UI integration. When the LLM calls
`generateSandboxedUi`, the runtime's `OpenGenerativeUIMiddleware`
converts the streaming tool call into `open-generative-ui` activity
events the built-in renderer mounts inside a sandboxed iframe.

Mirrors the langgraph-python `open_gen_ui_agent.py` reference.
"""

from __future__ import annotations

from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from fastapi import FastAPI


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


agent = ConversableAgent(
    name="open_gen_ui_assistant",
    system_message=SYSTEM_PROMPT,
    llm_config=LLMConfig({"model": "gpt-4.1", "stream": True}),
    human_input_mode="NEVER",
    max_consecutive_auto_reply=4,
    functions=[],
)

stream = AGUIStream(agent)
open_gen_ui_app = FastAPI()
open_gen_ui_app.mount("", stream.build_asgi())
