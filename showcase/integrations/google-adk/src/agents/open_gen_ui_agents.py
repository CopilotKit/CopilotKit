"""Agents backing the Open-Ended Generative UI demos.

Both variants ship the same backend behaviour — the agent emits raw HTML
or component-tree JSON inside an iframe-rendered surface. The frontend
sandboxes the output. The "advanced" variant additionally lets the
generated UI invoke frontend sandbox functions; that's purely a frontend
concern, the agent's job is identical.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent

_OPEN_GEN_UI_INSTRUCTION = (
    "You are a UI-generation assistant. When the user describes something "
    "they want to see (a card, a form, a small dashboard), respond with a "
    "well-structured fragment of self-contained HTML+CSS. Do not include "
    "<script> tags. Emit the HTML directly — the runtime's "
    "generateSandboxedUi tool handles rendering."
)

_OPEN_GEN_UI_ADVANCED_INSTRUCTION = (
    "You are a UI-generation assistant with frontend function-calling. "
    "When the user describes something interactive (a counter, a form, a "
    "small dashboard with buttons), respond with self-contained HTML+CSS "
    "+ a <script> block that calls the available sandbox functions exposed "
    "on `window.sandbox.*`. The frontend sandbox forwards those calls to "
    "the host page. Emit the HTML directly — the runtime's "
    "generateSandboxedUi tool handles rendering."
)

open_gen_ui_agent = LlmAgent(
    name="OpenGenUiAgent",
    model="gemini-2.5-flash",
    instruction=_OPEN_GEN_UI_INSTRUCTION,
    tools=[],
)

open_gen_ui_advanced_agent = LlmAgent(
    name="OpenGenUiAdvancedAgent",
    model="gemini-2.5-flash",
    instruction=_OPEN_GEN_UI_ADVANCED_INSTRUCTION,
    tools=[],
)
