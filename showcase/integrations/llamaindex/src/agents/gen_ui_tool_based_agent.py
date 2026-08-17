"""LlamaIndex agent for the Tool-Based Generative UI demo.

The frontend registers `render_bar_chart` and `render_pie_chart` tools via
`useComponent`. The D6 gen-ui-custom probe still sends the haiku prompt
for this slug (llamaindex is not in CHART_INTEGRATIONS). Register
`generate_haiku` as a complete-on-emit / render-only backend tool so that
fixture cannot hang the run waiting for a frontend handler.

Mirrors `langgraph-python/src/agents/gen_ui_tool_based.py` plus the haiku
complete-on-emit contract.
"""

import os
from typing import Annotated

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

from agents.hitl_in_chat_agent import FixedAGUIChatWorkflow


SYSTEM_PROMPT = """You are a data visualization and creative assistant.

When the user asks for a chart, call `render_bar_chart` or `render_pie_chart`
with a concise title, short description, and a `data` array of
`{label, value}` items. Pick bar for comparisons over a small set of
categories; pick pie for composition / share-of-whole.

When the user asks for a haiku, call `generate_haiku` with the Japanese
text, English translation, an image name, and a gradient color.

Keep chat responses brief -- let the visual output do the talking."""


def generate_haiku(
    japanese: Annotated[list, "3 lines of haiku in Japanese"],
    english: Annotated[list, "3 lines of haiku translated to English"],
    image_name: Annotated[str, "One relevant image name from the valid set"],
    gradient: Annotated[str, "CSS Gradient color for the background"],
) -> str:
    """Generate a haiku with Japanese text, English translation, and a background image."""
    return "Haiku generated!"


_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]


async def _gen_ui_tool_based_workflow_factory():
    wf = FixedAGUIChatWorkflow(
        llm=OpenAI(model="gpt-4o-mini", **_openai_kwargs),
        frontend_tools=[],
        backend_tools=[generate_haiku],
        system_prompt=SYSTEM_PROMPT,
        initial_state={},
    )
    # Complete-on-emit so we keep ONE assistant bubble. The probe's
    # haiku fallback reads the first copilot-assistant-message; a
    # second narration bubble leaves that first wrapper with no text.
    # English lines are streamed onto the same message in Fixed.
    wf.render_only_tool_names = {"generate_haiku"}
    return wf


gen_ui_tool_based_router = get_ag_ui_workflow_router(
    workflow_factory=_gen_ui_tool_based_workflow_factory,
)
