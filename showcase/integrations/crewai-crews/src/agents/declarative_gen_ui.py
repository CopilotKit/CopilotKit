"""Dedicated crew for the Declarative Generative UI (A2UI Dynamic Schema) demo.

Option A (JS-runtime-injected A2UI): the crew wires a no-arg `generate_a2ui`
tool whose body raises loudly if called — the CopilotKit runtime middleware
(`a2ui.injectA2UITool: true`, enabled by default in route.ts) intercepts the
toolcall before it reaches Python and drives the secondary `render_a2ui` LLM
pass itself.  The frontend renderer paints the emitted `a2ui_operations`.

The backend crew is tuned via role/backstory to call `generate_a2ui` (no
args) whenever a response would benefit from a rich visual, matching the
pattern in the langgraph-python reference agent (`a2ui_dynamic.py`).

CrewAI caveat: `ChatWithCrewFlow` wraps every chat turn in a CrewAI
"platform" system prompt that encourages the LLM to introduce itself and
ask for clarifying inputs before calling tools. We counter that via
`preseed_system_prompt` which installs a stronger `crew_description` so the
surrounding boilerplate still lands on a prompt that steers the LLM towards
tool-calling for visual requests.

Reference:
  langgraph-python/src/agents/a2ui_dynamic.py
"""

from __future__ import annotations

from crewai import Agent, Crew, Process, Task
from crewai.tools import BaseTool
from pydantic import BaseModel

from agents._chat_flow_helpers import preseed_system_prompt


class _NoArgInput(BaseModel):
    """Empty input schema — generate_a2ui takes no arguments."""


class _GenerateA2uiNoArgTool(BaseTool):
    """No-arg generate_a2ui tool for the injected A2UI pattern.

    The CopilotKit runtime middleware (`a2ui.injectA2UITool: true`) intercepts
    this toolcall before it reaches the Python body and drives the secondary
    `render_a2ui` LLM pass itself.  If this body actually runs, the middleware
    is misconfigured — fail loud per fail-loud-discipline rather than silently
    returning an empty surface.
    """

    name: str = "generate_a2ui"
    description: str = (
        "Generate a dynamic A2UI dashboard surface from the current conversation. "
        "Takes no arguments. The CopilotKit runtime middleware intercepts this call "
        "and drives the secondary render_a2ui pass automatically."
    )
    args_schema: type[BaseModel] = _NoArgInput

    def _run(self) -> str:  # type: ignore[override]
        raise RuntimeError(
            "generate_a2ui called directly — the CopilotKit a2ui middleware "
            "should intercept this call before it reaches the agent. "
            "Check the route configuration at "
            "app/api/copilotkit-declarative-gen-ui/route.ts."
        )


DECLARATIVE_GEN_UI_BACKSTORY = (
    "You are the embedded sales analyst for Vantage Threads, the fictional "
    "B2B apparel company described in your App Context. Answer every "
    "business question by calling `generate_a2ui` to draw a rich visual "
    "surface, and keep the chat reply to one short sentence. "
    "Ground every number in the sales dataset from App Context — never "
    "invent figures that contradict it. Follow the dashboard composition "
    "rules from App Context when choosing components: pick the component "
    "by the shape of the question (snapshot → composed KPI dashboard with "
    "charts; team performance → table; risk → status badges; single "
    "account → info rows; part-of-whole → pie; trend/comparison → bar). "
    "Never ask the user which chart they want. `generate_a2ui` takes no "
    "arguments and handles the rendering automatically. Compose "
    "generously — a dashboard should feel like a real analytics product, "
    "not a single widget."
)

CREW_NAME = "DeclarativeGenUI"

# Pre-seed the ag_ui_crewai cache so ChatWithCrewFlow skips its secondary
# description-generation LLM calls at construction time and embeds our
# verbatim guidance into build_system_message.
preseed_system_prompt(
    CREW_NAME,
    (
        "Declarative Generative UI demo (Vantage Threads sales analyst). "
        "Call generate_a2ui (no args) whenever a dashboard, chart, or card "
        "layout would improve the answer. Keep chat replies to one short sentence."
    ),
)


def _build_crew() -> Crew:
    agent = Agent(
        role="Declarative Generative UI Demo Assistant",
        goal=(
            "Answer the user by rendering branded A2UI components via the "
            "generate_a2ui tool whenever a visual would help."
        ),
        backstory=DECLARATIVE_GEN_UI_BACKSTORY,
        verbose=False,
        tools=[_GenerateA2uiNoArgTool()],
    )

    task = Task(
        description=(
            "Respond to the user. Call generate_a2ui when a chart, "
            "dashboard, or card layout would improve the answer."
        ),
        expected_output=(
            "A short one-sentence reply alongside any rendered A2UI surface."
        ),
        agent=agent,
    )

    return Crew(
        name=CREW_NAME,
        agents=[agent],
        tasks=[task],
        process=Process.sequential,
        verbose=False,
        chat_llm="gpt-4o",
    )


_cached_crew: Crew | None = None


class DeclarativeGenUI:
    """Adapter matching the `.crew()` + `.name` shape expected by
    `add_crewai_crew_fastapi_endpoint`.
    """

    name: str = CREW_NAME

    def crew(self) -> Crew:
        global _cached_crew
        if _cached_crew is None:
            _cached_crew = _build_crew()
        return _cached_crew
