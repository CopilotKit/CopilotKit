"""CrewAI Flow for the Declarative Generative UI (A2UI Dynamic Schema) demo.

The CopilotKit runtime injects the ``render_a2ui`` frontend tool.
This dedicated Flow forces that exact tool for every dashboard turn, so the
runtime can intercept it and drive the secondary ``render_a2ui`` LLM pass.
Using a raw Flow avoids ``ChatWithCrewFlow`` adding the crew itself as another
tool, which allowed live models to run the crew and return plain text instead
of mounting the requested surface.

Reference:
  langgraph-python/src/agents/a2ui_dynamic.py
"""

from __future__ import annotations

from typing import Any

from crewai.flow.flow import Flow, start
from litellm import acompletion
from pydantic import ConfigDict, Field

from ag_ui_crewai import CopilotKitState, copilotkit_stream


DECLARATIVE_GEN_UI_BACKSTORY = (
    "You are the embedded sales analyst for Vantage Threads, the fictional "
    "B2B apparel company described in your App Context. Answer every "
    "business question by calling `render_a2ui` to draw a rich visual "
    "surface, and keep the chat reply to one short sentence. "
    "Ground every number in the sales dataset from App Context — never "
    "invent figures that contradict it. Follow the dashboard composition "
    "rules from App Context when choosing components: pick the component "
    "by the shape of the question (snapshot → composed KPI dashboard with "
    "charts; team performance → table; risk → status badges; single "
    "account → info rows; part-of-whole → pie; trend/comparison → bar). "
    "Never ask the user which chart they want. Supply `render_a2ui` with "
    "the complete component tree needed for the answer. Compose "
    "generously — a dashboard should feel like a real analytics product, "
    "not a single widget."
)


class DeclarativeGenUIState(CopilotKitState):
    """Keep the context fields prepared by the AG-UI CrewAI endpoint."""

    model_config = ConfigDict(populate_by_name=True)

    context: list[dict[str, Any]] = Field(default_factory=list)
    ag_ui: dict[str, Any] = Field(default_factory=dict, alias="ag-ui")


def _system_prompt(state: DeclarativeGenUIState) -> str:
    context_sections = []
    for entry in state.context:
        description = str(entry.get("description") or "App Context")
        value = entry.get("value")
        if value is not None:
            context_sections.append(f"{description}:\n{value}")

    a2ui_schema = state.ag_ui.get("a2ui_schema")
    if a2ui_schema:
        context_sections.append(
            "A2UI catalog schema and tool usage guide:\n" + str(a2ui_schema)
        )

    if not context_sections:
        return DECLARATIVE_GEN_UI_BACKSTORY
    return (
        DECLARATIVE_GEN_UI_BACKSTORY
        + "\n\nApp Context:\n"
        + "\n\n".join(context_sections)
    )


class DeclarativeGenUIFlow(Flow[DeclarativeGenUIState]):
    """Force the runtime-owned A2UI tool and preserve its streamed tool call."""

    @start()
    async def chat(self) -> None:
        actions = list(self.state.copilotkit.actions)
        action_names = {
            action.get("function", {}).get("name")
            for action in actions
            if isinstance(action, dict)
        }
        if "render_a2ui" not in action_names:
            raise RuntimeError(
                "CopilotKit did not inject the required render_a2ui tool. "
                "Check a2ui.injectA2UITool on the declarative GenUI runtime."
            )

        response = await copilotkit_stream(
            await acompletion(
                model="openai/gpt-5.4",
                messages=[
                    {"role": "system", "content": _system_prompt(self.state)},
                    *self.state.messages,
                ],
                tools=actions,
                tool_choice={
                    "type": "function",
                    "function": {"name": "render_a2ui"},
                },
                parallel_tool_calls=False,
                stream=True,
            )
        )
        self.state.messages.append(response.choices[0].message)


declarative_gen_ui_flow = DeclarativeGenUIFlow()
