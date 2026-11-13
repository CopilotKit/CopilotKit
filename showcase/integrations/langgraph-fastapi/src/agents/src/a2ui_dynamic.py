"""LangGraph agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo."""

from __future__ import annotations

import os
from typing import TypedDict

from ag_ui_langgraph import get_a2ui_tools
from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI


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
    "Never ask the user which chart they want. For a new surface, call "
    "`generate_a2ui` without arguments. It handles rendering automatically. "
    "Compose generously so a dashboard feels like a real analytics product."
)


A2UIState = TypedDict("A2UIState", {"ag-ui": dict}, total=False)

model = ChatOpenAI(
    reasoning_effort="none", model=os.getenv("OPENAI_MODEL", "gpt-6-luna")
)
graph = create_agent(
    model=model,
    state_schema=A2UIState,
    tools=[
        get_a2ui_tools(
            {"model": model, "default_catalog_id": "declarative-gen-ui-catalog"}
        )
    ],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
