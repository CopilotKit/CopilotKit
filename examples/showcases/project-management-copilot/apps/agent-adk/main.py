"""
Google ADK PM-copilot agent, exposed via the ag-ui-adk bridge over FastAPI.

Same tool surface as apps/agent (LangGraph) — the frontend is agent-agnostic.
"""

import os

# Honor the deterministic-demo mode (same env contract as the langgraph agent
# and the BFF).
if os.environ.get("USE_MOCK") == "1":
    os.environ.setdefault("OPENAI_BASE_URL", "http://localhost:4010/v1")
    os.environ.setdefault("OPENAI_API_KEY", "mock")
    print(
        f"[agent-adk] USE_MOCK=1 — routing OpenAI to {os.environ['OPENAI_BASE_URL']}",
        flush=True,
    )

from fastapi import FastAPI

from ag_ui_adk import ADKAgent, AGUIToolset, add_adk_fastapi_endpoint
from google.adk.agents import Agent as ADKBaseAgent
from google.adk.models.lite_llm import LiteLlm

from src.tools import (
    analyze_backlog,
    get_issues,
    manage_issues,
    propose_issue_change,
)


SYSTEM_PROMPT = """
You are the Dashboard Designer — an analytics copilot for an engineering
team's project board. The user sees a dashboard pane (NOT a kanban) with
aggregated stats: total issues, in-progress count, urgent count, unassigned
count, plus breakdowns by status, priority, and assignee. Each issue has an
id, title, status (Backlog / Todo / In Progress / In Review / Done),
priority (Urgent / High / Med / Low), optional assignee, and labels.

Your job is to answer questions about the backlog by RESHAPING THE DASHBOARD
rather than describing the answer in chat. When the user asks "show me
Sarah's work", "filter to urgent only", "who has the most open work?",
"break it down by priority" — call updateDashboard with the appropriate
filter and a short focus sentence; the dashboard re-derives every chart
from the filtered set immediately.

Keep replies to ONE short sentence after a tool call. The dashboard does
the heavy explaining. If the user asks for a number that's plainly visible
after a filter, just confirm it. If they ask something the filter can't
express (e.g. trend over time, comparisons between two filters), answer in
chat without a tool call.

Tools:
- updateDashboard (frontend tool): the primary tool. Pass a filter object
  ({assignee, priority, status, labels}) replacing the previous filter
  wholesale, plus a one-line `focus` sentence shown in the dashboard
  header. Pass an empty filter ({}) to reset.
- get_issues: read the raw issue list when you need facts the filter
  alone can't surface (e.g. counting a specific subset before answering).
- analyze_backlog: open-ended analysis when the user asks "what should we
  cut?" or "what's blocking ship?".
- manage_issues / propose_issue_change: mutations. Avoid in dashboard
  mode unless the user explicitly asks to change an issue.
""".strip()


# We route ADK through LiteLLM so the same OPENAI_BASE_URL / OPENAI_API_KEY
# env that the LangGraph side honors also drives ADK. This means USE_MOCK=1
# replays aimock fixtures for both agents identically.
_model = LiteLlm(
    model=os.environ.get("ADK_MODEL", "openai/gpt-4.1"),
)

_inner_agent = ADKBaseAgent(
    name="pm_copilot_adk",
    model=_model,
    instruction=SYSTEM_PROMPT,
    # AGUIToolset() is a placeholder — the ag_ui_adk bridge swaps it for a
    # ClientProxyToolset at request time, registering whatever frontend
    # tools the React app sent in this run (updateDashboard, toggleTheme,
    # applyPlanningChanges, etc). Without it, ADK only sees the four
    # backend Python tools and rejects every frontend-tool call as
    # "hallucinated".
    tools=[
        get_issues,
        manage_issues,
        propose_issue_change,
        analyze_backlog,
        AGUIToolset(),
    ],
)

adk_agent = ADKAgent(
    adk_agent=_inner_agent,
    app_name="pm_copilot",
    user_id="jordan-beamson",
    use_in_memory_services=True,
)

app = FastAPI(title="PM Copilot — ADK")
add_adk_fastapi_endpoint(app, adk_agent)


@app.get("/ok")
def ok() -> dict[str, str]:
    return {"status": "ok"}
