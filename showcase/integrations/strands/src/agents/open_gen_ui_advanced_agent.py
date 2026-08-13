"""Dedicated Strands agent for the Open Generative UI (Advanced) demo.

The advanced variant: agent-authored sandboxed UI can invoke
frontend-registered **sandbox functions** — host-page functions made
callable from inside the iframe via
`await Websandbox.connection.remote.<name>(args)`.

End-to-end:
- The frontend passes `openGenerativeUI={{ sandboxFunctions }}` to the
  provider; descriptors land in agent context.
- The runtime forwards the auto-registered `generateSandboxedUi` tool
  and the sandbox-function descriptors (via AG-UI context).
- The LLM generates HTML + JS that calls
  `Websandbox.connection.remote.<name>(...)` on user interactions.
- `OpenGenerativeUIMiddleware` converts the streaming tool call into
  `open-generative-ui` activity events for the sandboxed renderer.

The minimal sibling is `open_gen_ui.py` (`build_open_gen_ui_agent`).
"""

from __future__ import annotations

from textwrap import dedent

from strands import Agent
from ag_ui_strands import StrandsAgent

from agents.agent import _build_model

SYSTEM_PROMPT = dedent(
    """
    You are a UI-generating assistant for the Open Generative UI (Advanced) demo.

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
).strip()


def build_open_gen_ui_advanced_agent() -> StrandsAgent:
    """Construct the advanced Open Generative UI StrandsAgent.

    `generateSandboxedUi` is frontend-injected; tools stay empty. The system
    prompt requires interactive UIs that call
    `Websandbox.connection.remote.*` host bridges.
    """
    strands_agent = Agent(
        model=_build_model(),
        system_prompt=SYSTEM_PROMPT,
        tools=[],
    )

    return StrandsAgent(
        agent=strands_agent,
        name="open_gen_ui_advanced",
        description=(
            "Generates interactive sandboxed UI that calls host-side "
            "sandbox functions via `Websandbox.connection.remote.*`."
        ),
    )


__all__ = ["SYSTEM_PROMPT", "build_open_gen_ui_advanced_agent"]
