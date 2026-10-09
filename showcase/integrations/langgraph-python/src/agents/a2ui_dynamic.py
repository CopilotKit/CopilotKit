"""LangGraph agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo."""

from __future__ import annotations

import os

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_openai import ChatOpenAI


# Cross-reference: showcase/integrations/google-adk/src/agents/declarative_gen_ui_agent.py
# Both integrations register the same a2ui catalog (Card / Row / Column /
# Text / Metric / PieChart / BarChart / DataTable / StatusBadge / InfoRow /
# PrimaryButton — see each integration's
# src/app/demos/declarative-gen-ui/a2ui/definitions.ts, which are
# byte-identical across LP and ADK).
#
# The fictional sales dataset and the per-question composition rules
# are injected via App Context from
# showcase/integrations/langgraph-python/src/app/demos/declarative-gen-ui/sales-context.ts
# (a frontend file shared byte-for-byte with the ADK integration — see
# its DUPLICATION NOTICE).
#
# Keep this SYSTEM_PROMPT and the ADK `_INSTRUCTION` aligned in spirit.
# Minor wording differences are tolerated (e.g. this prompt uses shape
# words — "table"/"pie"/"bar" — as question-category descriptors, while
# ADK names the rendered components — "DataTable"/"PieChart"/"BarChart"
# — in the analogous slot), but the structural rules and the component
# name set must match the catalog above.
SYSTEM_PROMPT = (
    "You are the embedded sales analyst for Vantage Threads, the fictional "
    "B2B apparel company described in your App Context. Answer every "
    "business question by calling `generate_a2ui` to draw a rich visual "
    "surface, and keep the chat reply to one short sentence.\n"
    "\n"
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


@tool
def generate_a2ui() -> dict:
    """Generate a dynamic A2UI dashboard surface from the current conversation.

    Takes no arguments. The CopilotKit runtime middleware
    (`a2ui.injectA2UITool: true`) intercepts the call and drives a
    secondary-LLM `render_a2ui` planner to emit the surface ops; this
    Python body should NEVER execute in normal operation. It exists only
    so the LP agent's declared `tools=` list mirrors the ADK sibling
    (`declarative_gen_ui_agent.py`) and the SYSTEM_PROMPT's
    `generate_a2ui` reference resolves to a registered tool name.

    If this body actually runs, the CopilotKit a2ui middleware is
    misconfigured and silently returning an empty surface would hide the
    real bug — fail loud per `fail-loud-discipline`.
    """
    raise RuntimeError(
        "generate_a2ui called directly — CopilotKit a2ui.injectA2UITool "
        "middleware should intercept this call before it reaches the "
        "agent. Check the route configuration at "
        "app/api/copilotkit-declarative-gen-ui/route.ts."
    )


graph = create_agent(
    model=ChatOpenAI(model=os.getenv("OPENAI_MODEL", "gpt-4o")),
    tools=[generate_a2ui],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
