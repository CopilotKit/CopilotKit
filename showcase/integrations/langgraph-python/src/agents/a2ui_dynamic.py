"""LangGraph agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo."""

from __future__ import annotations

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI


# Mirrored verbatim in google-adk's declarative_gen_ui_agent.py — keep in
# sync. The fictional sales dataset and the per-question component-composition
# rules arrive via App Context (registered by the frontend in
# declarative-gen-ui/sales-context.ts), so they are not duplicated here.
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


graph = create_agent(
    model=ChatOpenAI(model="gpt-5.4"),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
