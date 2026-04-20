"""LangGraph agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo.

The full reference implementation in
`examples/integrations/langgraph-python/agent/src/a2ui_dynamic_schema.py`
uses a *secondary LLM* bound to a `render_a2ui` tool to generate A2UI v0.9
components on the fly from the conversation context.

To keep this showcase demo MINIMAL and deterministic, this version ships a
**placeholder** `generate_a2ui` tool that emits a fixed, hand-authored A2UI
payload (a tiny dashboard). The wire format and middleware contract are
identical to the dynamic case — only the authorship of the schema differs.
Swap `_build_placeholder_operations()` for a secondary-LLM call to get the
fully dynamic version.
"""

from __future__ import annotations

from typing import Any

from langchain.agents import create_agent
from langchain.tools import tool
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware, a2ui

SURFACE_ID = "dynamic-dashboard"


def _build_placeholder_components() -> list[dict[str, Any]]:
    """Fixed, hand-authored A2UI v0.9 components mimicking a dynamic response.

    In the real dynamic demo these are produced by a secondary LLM via a
    `render_a2ui` tool call. We emit only components from the default A2UI
    basicCatalog so this demo works without registering a custom catalog.
    """
    return [
        {
            "id": "root",
            "component": "Column",
            "gap": 12,
            "children": ["title", "subtitle", "price", "cta"],
        },
        {
            "id": "title",
            "component": "Text",
            "text": "Flight SFO → JFK",
            "variant": "h2",
        },
        {
            "id": "subtitle",
            "component": "Text",
            "text": "United Airlines · Tue, Mar 18 · 4h 25m",
            "variant": "caption",
        },
        {
            "id": "price",
            "component": "Text",
            "text": "$289",
            "variant": "h3",
        },
        {
            "id": "cta",
            "component": "Button",
            "child": "cta-label",
            "variant": "primary",
            "action": {"event": {"name": "book_flight"}},
        },
        {
            "id": "cta-label",
            "component": "Text",
            "text": "Book flight",
        },
    ]


@tool
def generate_a2ui(prompt: str) -> str:
    """Generate a dynamic A2UI surface based on the user's request.

    Call this whenever the user asks to "show" or "render" a card, dashboard,
    or rich UI. The result is an `a2ui_operations` container that the
    CopilotKit A2UI middleware detects and forwards to the frontend renderer.
    """
    components = _build_placeholder_components()
    return a2ui.render(
        operations=[
            a2ui.create_surface(SURFACE_ID),
            a2ui.update_components(SURFACE_ID, components),
        ]
    )


SYSTEM_PROMPT = (
    "You are a demo assistant for Declarative Generative UI (A2UI dynamic "
    "schema). When the user asks to show or render a dashboard, card, or any "
    "rich UI, call the `generate_a2ui` tool. Keep chat responses to one short "
    "sentence — the UI does the talking."
)

model = ChatOpenAI(model="gpt-4o-mini")

graph = create_agent(
    model=model,
    tools=[generate_a2ui],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
