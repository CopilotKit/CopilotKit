"""CrewAI Flow backing the Tool-Based Generative UI demo.

Mirrors `langgraph-python/src/agents/gen_ui_tool_based.py`: the frontend
registers `render_bar_chart` and `render_pie_chart`, the runtime injects them
as actions, and the model calls one of them so the browser renders the chart.

The cell needs its own backend rather than the neutral chat Flow: it must force
a chart call on the user's turn and then narrate once the browser returns the
result, so the run does not bounce between the model and the browser.
"""

from __future__ import annotations

from crewai.flow.flow import Flow, start
from litellm import acompletion

from ag_ui_crewai import CopilotKitState, copilotkit_stream


SYSTEM_PROMPT = (
    "You are a data visualization assistant.\n\n"
    "When the user asks for a chart, call `render_bar_chart` or "
    "`render_pie_chart` with a concise title, short description, and a `data` "
    "array of `{label, value}` items. Pick bar for comparisons over a small "
    "set of categories; pick pie for composition / share-of-whole.\n\n"
    "If the user names a chart subject but does NOT supply concrete numbers, "
    "do NOT ask them for data. Invent plausible illustrative sample values "
    "yourself, call the appropriate `render_*` tool immediately, and briefly "
    "note in the follow-up that the values are illustrative samples. Always "
    "render the chart on the first turn -- never reply with a clarifying "
    "question asking for the data.\n\n"
    "Keep chat responses brief -- let the chart do the talking."
)


class GenUiToolBasedFlow(Flow[CopilotKitState]):
    """Stream one model step; the browser owns chart rendering."""

    @start()
    async def chat(self) -> None:
        actions = self.state.copilotkit.actions or None
        on_user_turn = bool(
            self.state.messages and self.state.messages[-1].get("role") == "user"
        )
        response = await copilotkit_stream(
            await acompletion(
                model="openai/gpt-5.4",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    *self.state.messages,
                ],
                tools=actions,
                # Force the chart on the user's turn. Once the browser has
                # returned the render result the follow-up is plain narration,
                # so leaving this on "auto" is what ends the run.
                tool_choice="required" if actions and on_user_turn else "auto",
                parallel_tool_calls=False,
                stream=True,
            )
        )
        self.state.messages.append(response.choices[0].message)


gen_ui_tool_based_flow = GenUiToolBasedFlow()
