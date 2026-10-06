"""Minimal repro: ag-ui-adk 0.7.1's A2UI "user prevails" check misses a
generate_a2ui wired as a plain function.

ADKAgent builds existing_tool_names from getattr(tool, "name", None) over
LlmAgent.tools. A plain Python function (the usual ADK way to declare a tool)
has __name__, not .name, so plan_a2ui_injection does not see it and injects a
second generate_a2ui. A FunctionTool-wrapped one is seen and injection is
skipped.
"""

from ag_ui.core import RunAgentInput
from ag_ui_adk.a2ui_tool import plan_a2ui_injection
from google.adk.agents import LlmAgent
from google.adk.tools import FunctionTool


def generate_a2ui() -> dict:
    """A dev-wired generate_a2ui."""
    return {}


run = RunAgentInput(
    thread_id="t",
    run_id="r",
    state={},
    messages=[],
    tools=[],
    context=[],
    forwarded_props={"injectA2UITool": True},
)
for label, tools in (
    ("plain function", [generate_a2ui]),
    ("FunctionTool", [FunctionTool(generate_a2ui)]),
):
    agent = LlmAgent(name="a", model="gemini-2.5-flash", tools=tools)
    names = [
        n for t in agent.tools if (n := getattr(t, "name", None))
    ]  # adk_agent.py:3224
    plan = plan_a2ui_injection(
        model=agent.canonical_model, input=run, existing_tool_names=names
    )
    print(
        f"{label:15} existing_tool_names={names} -> "
        f"{'injects a second generate_a2ui' if plan else 'skips injection (user prevails)'}"
    )
