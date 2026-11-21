"""
Main entry point for the agent.

Project-management copilot. The agent owns the issue list (kanban state) and
exposes tools the frontend can call. State lives in the agent and syncs
bidirectionally to the React app via CopilotKit v2.
"""

import os
from typing import Any

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langchain.agents.middleware.types import AgentMiddleware

# Deterministic demo mode. When USE_MOCK=1 (set by `npm run dev:mock`), route
# every OpenAI call through the local aimock server. The fixtures in
# fixtures/ define the canned responses for the demo scenarios.
if os.environ.get("USE_MOCK") == "1":
    os.environ.setdefault("OPENAI_BASE_URL", "http://localhost:4010/v1")
    os.environ.setdefault("OPENAI_API_KEY", "mock")
    print(
        f"[agent] USE_MOCK=1 — routing OpenAI to {os.environ['OPENAI_BASE_URL']}",
        flush=True,
    )

# Domain tools
from src.a2ui_dynamic_schema import generate_a2ui
from src.a2ui_fixed_schema import search_flights
from src.analysis import analyze_backlog
from src.issues import AgentState, _seed_issues, issue_tools
from src.query import query_data


class SeedIssuesMiddleware(AgentMiddleware):
    """Populate state.issues with the seed list on first run of a thread.

    Distinguish "unset" (None — first run, seed) from "explicitly empty"
    ([] — user cleared the board, leave alone). Treating [] as missing
    re-seeds on every subsequent run and silently undoes /clear.
    """

    def before_agent(self, state: Any, runtime: Any) -> dict | None:  # type: ignore[override]
        try:
            current = state.get("issues") if isinstance(state, dict) else getattr(state, "issues", None)
        except Exception:
            current = None
        if current is None:
            return {"issues": _seed_issues()}
        return None


agent = create_agent(
    model="openai:gpt-4.1",
    tools=[
        query_data,
        *issue_tools,
        analyze_backlog,
        generate_a2ui,
        search_flights,
    ],
    middleware=[CopilotKitMiddleware(), SeedIssuesMiddleware()],
    state_schema=AgentState,
    system_prompt="""
        You are a project-management copilot. You help an engineering team
        triage, plan, and ship work. The user can see a kanban board with five
        columns (Backlog / Todo / In Progress / In Review / Done). Each issue
        has an id, title, description, status, priority (Urgent/High/Med/Low),
        optional assignee, labels, and due date.

        Keep replies to 1-2 sentences unless asked for detail.

        Tool guidance:
        - Reading the board: call get_issues to see what's there.
        - Bulk edits (planning a sprint, batch status moves, importing from a
          PDF): call manage_issues with the full new list.
        - Single edit (moving one issue, changing one assignee): call
          propose_issue_change so the user approves via the in-chat card.
        - Showing issues inline in chat: call the issueList frontend tool
          directly with issueIds=[...]. It renders the issues as glass cards
          with a "View on board" button. Call get_issues first if you don't
          already have the ids.
        - Planning notes the user shares inline ("here's our sprint planning
          notes", "use this meeting notes"): call the attachMeetingNotes
          frontend tool first with filename, size, and the full content. It
          animates an "attached file" card so the user can see what document
          you're working from before you propose changes.
        - Deep analysis ("what should we cut?", "what's blocking ship?"): call
          analyze_backlog. It emits step-by-step progress that shows up in the
          shared-state timeline panel.
        - Charts: call query_data first, then render with pieChart / barChart.
        - Dashboards: generate_a2ui.
        - Flights: search_flights (kept as a generic A2UI demo).
        - Attachments: when the user attaches a PDF (e.g. a PRD or spec), read
          it directly and convert findings into new issues with manage_issues.
    """,
)

graph = agent
