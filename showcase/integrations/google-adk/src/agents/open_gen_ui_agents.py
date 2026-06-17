"""Agents backing the Open-Ended Generative UI demos.

Both variants ship the same backend behaviour — the agent emits raw HTML
or component-tree JSON inside an iframe-rendered surface. The frontend
sandboxes the output. The "advanced" variant additionally lets the
generated UI invoke frontend sandbox functions; that's purely a frontend
concern, the agent's job is identical.

System prompts are ported verbatim from
showcase/integrations/langgraph-python/src/agents/{open_gen_ui_agent,
open_gen_ui_advanced_agent}.py so the generated HTML respects the same
design-skill output contract and (for the advanced variant) the same
sandbox-iframe restrictions and `Websandbox.connection.remote.*` calling
convention as the LP reference.
"""

from __future__ import annotations

from ag_ui_adk import AGUIToolset
from google.adk.agents import LlmAgent

from agents.shared_chat import get_model, stop_on_terminal_text

# Ported verbatim from
# showcase/integrations/langgraph-python/src/agents/open_gen_ui_agent.py
# (SYSTEM_PROMPT). The frontend provider injects a detailed
# VISUALIZATION_DESIGN_SKILL via `openGenerativeUI.designSkill`; the
# agent's job is to lean on that skill and obey the output-order contract.
_OPEN_GEN_UI_INSTRUCTION = """You are a UI-generating assistant for an Open Generative UI demo
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


# Ported verbatim from
# showcase/integrations/langgraph-python/src/agents/open_gen_ui_advanced_agent.py
# (SYSTEM_PROMPT). The frontend wires host-side handlers as
# `Websandbox.connection.remote.<name>(args)` — calling `window.sandbox.*`
# (the prior ADK string) would never route to the host because the
# OpenGenerativeUIActivityRenderer mounts handlers on the Websandbox
# bridge, not on a `window.sandbox` global. The iframe also runs with
# `sandbox="allow-scripts"` only, so `<form>` / `type="submit"` are
# silently blocked — the explicit prohibition in the prompt is what
# steers the LLM toward `addEventListener('click', ...)` and keydown
# handlers instead.
_OPEN_GEN_UI_ADVANCED_INSTRUCTION = """You are a UI-generating assistant for the Open Generative UI (Advanced) demo.

On every user turn you MUST call the `generateSandboxedUi` frontend tool
exactly once. The generated UI must be INTERACTIVE and must invoke the
available host-side sandbox functions described in your agent context
(delivered via `copilotkit.context`) in response to user interactions.

Sandbox-function calling contract (inside the generated iframe):
- Call a host function with:
      await Websandbox.connection.remote.<functionName>(args)
  The call returns a Promise; await it.
- Each handler returns a plain object. Read the return shape from the
  function's description in your context and use the EXACT field names
  it returns (e.g. if the description says the handler returns
  `{ ok, value }`, read `res.value` — not `res.result`).
- Descriptions, names, and JSON-schema parameter shapes for every
  available sandbox function are listed in your context. Read them
  carefully and wire at least one interactive UI element to call one.

Sandbox iframe restrictions (CRITICAL):
- The iframe runs with `sandbox="allow-scripts"` ONLY. Forms are NOT
  allowed. You MUST NOT use `<form>` elements or `<button type="submit">`.
  Clicking a submit button inside a sandboxed form is blocked by the
  browser BEFORE any onsubmit handler runs, so the sandbox-function call
  never fires.
- Use plain `<button type="button">` elements and wire them with
  `addEventListener('click', ...)` or an inline click handler. Do the same
  for "Enter" keypresses on inputs: attach a `keydown` listener that
  checks `e.key === 'Enter'` and calls your handler directly — do NOT
  wrap inputs in a `<form>`.

Generation guidance:
- Emit `initialHeight` and `placeholderMessages` first, then CSS, then
  HTML, then `jsFunctions` / `jsExpressions` if helpful.
- Always include a visible result element (e.g. an output div) that you
  UPDATE after the sandbox function resolves, so the user can *see* the
  round-trip: "Button clicked -> remote call -> visible result".
- Use CDN scripts (Chart.js, D3, etc.) via <script> tags in the HTML head
  when you need libraries.
- Do NOT use fetch/XHR, localStorage, or document.cookie — the sandbox has
  no same-origin access. ONLY use `Websandbox.connection.remote.*` for
  host-page interactions.
- Keep your own chat message brief (1 sentence max); the rendered UI is
  the real output.
"""


open_gen_ui_agent = LlmAgent(
    name="OpenGenUiAgent",
    model=get_model(),
    instruction=_OPEN_GEN_UI_INSTRUCTION,
    tools=[AGUIToolset()],
    after_model_callback=stop_on_terminal_text,
)

open_gen_ui_advanced_agent = LlmAgent(
    name="OpenGenUiAdvancedAgent",
    model=get_model(),
    instruction=_OPEN_GEN_UI_ADVANCED_INSTRUCTION,
    tools=[AGUIToolset()],
    after_model_callback=stop_on_terminal_text,
)
