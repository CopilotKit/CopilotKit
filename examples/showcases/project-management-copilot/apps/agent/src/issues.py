"""
Issue domain model + tools.

Matches the Linear/Notion-style kanban shape:
- 5 statuses (Backlog / Todo / In Progress / In Review / Done)
- 4 priorities (Urgent / High / Med / Low)
- optional assignee, labels, due date

State lives in the agent (CopilotKit v2 agent-state pattern).
"""

from datetime import date, datetime, timezone
from langchain.agents import AgentState as BaseAgentState
from langchain.tools import ToolRuntime, tool
from langchain.messages import ToolMessage
from langgraph.types import Command
from typing import TypedDict, Literal, Optional
import uuid


IssueStatus = Literal["Backlog", "Todo", "In Progress", "In Review", "Done"]
IssuePriority = Literal["Urgent", "High", "Med", "Low"]


class Issue(TypedDict, total=False):
    id: str
    title: str
    description: str
    status: IssueStatus
    priority: IssuePriority
    assignee: Optional[str]
    labels: list[str]
    dueDate: Optional[str]


class AnalysisProgress(TypedDict, total=False):
    step: str
    label: str
    count: int
    focus: str
    by_status: dict[str, int]
    urgent_count: int
    high_count: int
    urgent_ids: list[str]
    plan: str


class AgentState(BaseAgentState):
    issues: list[Issue]
    # Streamed by analyze_backlog via copilotkit_emit_state. Frontend
    # subscribes to agent.state.analysis to drive the timeline.
    analysis: AnalysisProgress


def _seed_issues() -> list[Issue]:
    """Realistic seed data so the board isn't empty on first load."""
    return [
        {
            "id": "ISS-101",
            "title": "Payment integration flaky on Safari",
            "description": (
                "Customers on Safari 17 see the Stripe Elements iframe fail to "
                "mount about 1 in 8 sessions. Repro steps in the linked Sentry "
                "trace; suspect CORS preflight timeout."
            ),
            "status": "In Progress",
            "priority": "Urgent",
            "assignee": "Alex",
            "labels": ["bug", "payments"],
            "dueDate": "2026-05-22",
        },
        {
            "id": "ISS-102",
            "title": "Q3 roadmap kickoff",
            "description": (
                "Pull together the candidate list of Q3 themes and circulate to "
                "leadership for prioritization by end of week."
            ),
            "status": "Todo",
            "priority": "High",
            "assignee": "Sarah",
            "labels": ["planning"],
            "dueDate": "2026-05-24",
        },
        {
            "id": "ISS-103",
            "title": "Migrate auth middleware off legacy session store",
            "description": (
                "We still have one path that reads from the old Redis session "
                "format. Cut it over to the new JWT flow."
            ),
            "status": "In Review",
            "priority": "High",
            "assignee": "Jordan",
            "labels": ["infra", "tech-debt"],
            "dueDate": "2026-05-20",
        },
        {
            "id": "ISS-104",
            "title": "Onboarding tour skips step 3 on mobile",
            "description": (
                "The 'invite teammates' step only renders on viewports > 768px. "
                "Add the mobile layout."
            ),
            "status": "Todo",
            "priority": "Med",
            "assignee": "Priya",
            "labels": ["bug", "frontend"],
        },
        {
            "id": "ISS-105",
            "title": "Improve API rate-limit error copy",
            "description": (
                "The current 429 surface just says 'Too many requests'. Add a "
                "retry-after hint and a link to docs."
            ),
            "status": "Backlog",
            "priority": "Low",
            "assignee": "Alex",
            "labels": ["polish"],
        },
        {
            "id": "ISS-106",
            "title": "Add dark mode to invoice PDF template",
            "description": (
                "Customer-facing invoices currently fail to render correctly "
                "when the workspace theme is dark."
            ),
            "status": "Backlog",
            "priority": "Low",
            "assignee": "Sarah",
            "labels": ["design"],
        },
        {
            "id": "ISS-107",
            "title": "Postgres connection pool exhaustion at peak",
            "description": (
                "Pool fills at ~3 PM PT on weekdays. Either tune pool size or "
                "add a read replica for analytics queries."
            ),
            "status": "In Progress",
            "priority": "Urgent",
            "assignee": "Jordan",
            "labels": ["infra", "performance"],
            "dueDate": "2026-05-19",
        },
        {
            "id": "ISS-108",
            "title": "Customer interview synthesis — Q2 cohort",
            "description": (
                "Synthesize the 12 customer interviews from April into a 1-page "
                "memo with three opportunity areas."
            ),
            "status": "Todo",
            "priority": "Med",
            "assignee": "Priya",
            "labels": ["research"],
            "dueDate": "2026-05-26",
        },
        {
            "id": "ISS-109",
            "title": "Replace homepage hero illustration",
            "description": (
                "Marketing has new brand art. Swap the SVG and update the alt "
                "text."
            ),
            "status": "Done",
            "priority": "Low",
            "assignee": "Sarah",
            "labels": ["marketing"],
        },
        {
            "id": "ISS-110",
            "title": "Audit npm dependencies for CVEs",
            "description": (
                "Run a fresh `npm audit` across the workspace and triage the "
                "highs. Document the false-positive cases."
            ),
            "status": "In Review",
            "priority": "Med",
            "assignee": "Alex",
            "labels": ["security", "tech-debt"],
        },
        {
            "id": "ISS-111",
            "title": "Search results pagination drops query param",
            "description": (
                "Clicking page 2 resets the search filter. Fix the URL builder "
                "in SearchResults.tsx."
            ),
            "status": "Backlog",
            "priority": "Med",
            "assignee": "Jordan",
            "labels": ["bug", "frontend"],
        },
        {
            "id": "ISS-112",
            "title": "Write blog post: how we cut p95 latency 40%",
            "description": (
                "Draft and review with eng leadership before publishing."
            ),
            "status": "Todo",
            "priority": "Low",
            "assignee": "Priya",
            "labels": ["marketing", "writing"],
        },
        {
            "id": "ISS-113",
            "title": "GDPR data export endpoint",
            "description": (
                "EU customers need a self-serve way to export their full account "
                "data. Schema design + endpoint."
            ),
            "status": "Backlog",
            "priority": "High",
            "assignee": "Sarah",
            "labels": ["compliance", "backend"],
            "dueDate": "2026-06-15",
        },
        {
            "id": "ISS-114",
            "title": "Replace lodash with native ES utilities",
            "description": (
                "Bundle size win, plus the migration off lodash means we drop "
                "one transitive vulnerable dep."
            ),
            "status": "In Progress",
            "priority": "Low",
            "assignee": "Alex",
            "labels": ["tech-debt", "frontend"],
        },
        {
            "id": "ISS-115",
            "title": "Onboarding email sequence A/B test",
            "description": (
                "Test sending day-3 email at 9 AM local vs. 5 PM local. Looking "
                "for activation lift."
            ),
            "status": "In Review",
            "priority": "Med",
            "assignee": "Priya",
            "labels": ["growth", "experiment"],
        },
        {
            "id": "ISS-116",
            "title": "Sketch checkout redesign in Excalidraw",
            "description": (
                "Quick whiteboard pass before we commit to a Figma file. Cover "
                "guest checkout + upsell modal."
            ),
            "status": "Backlog",
            "priority": "Med",
            "assignee": "Sarah",
            "labels": ["design"],
        },
        {
            "id": "ISS-117",
            "title": "Migrate analytics events to typed schema",
            "description": (
                "Stop relying on free-form event names. Generate a TS union "
                "from a single source of truth."
            ),
            "status": "Todo",
            "priority": "Med",
            "assignee": "Jordan",
            "labels": ["tech-debt", "analytics"],
        },
        {
            "id": "ISS-118",
            "title": "Bug: Slack notifications duplicate on retry",
            "description": (
                "Our retry middleware doesn't dedupe webhook calls. Customers "
                "are seeing the same message twice when our worker scales."
            ),
            "status": "In Progress",
            "priority": "High",
            "assignee": "Alex",
            "labels": ["bug", "integrations"],
            "dueDate": "2026-05-21",
        },
        {
            "id": "ISS-119",
            "title": "Performance: bundle size budget for /app",
            "description": (
                "Set up a CI check that fails the build if the main bundle "
                "grows past 300kb gzipped."
            ),
            "status": "Backlog",
            "priority": "Low",
            "assignee": "Jordan",
            "labels": ["performance", "ci"],
        },
        {
            "id": "ISS-120",
            "title": "Update terms of service for new pricing",
            "description": (
                "Legal review for the metered-usage clause. Coordinate with "
                "finance on the effective date."
            ),
            "status": "Done",
            "priority": "Med",
            "assignee": "Priya",
            "labels": ["compliance"],
        },
    ]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@tool
def manage_issues(issues: list[Issue], runtime: ToolRuntime) -> Command:
    """
    Manage the current issues. Pass the full list of issues you want to persist.

    Use this for bulk operations (creating multiple issues, reordering,
    bulk status changes). For a single edit prefer propose_issue_change so
    the user can approve via the HITL flow.
    """
    # Ensure every issue has an id + required fields
    for issue in issues:
        if "id" not in issue or not issue["id"]:
            issue["id"] = f"ISS-{str(uuid.uuid4())[:8]}"
        issue.setdefault("status", "Backlog")
        issue.setdefault("priority", "Med")
        issue.setdefault("labels", [])
        issue.setdefault("description", "")

    return Command(
        update={
            "issues": issues,
            "messages": [
                ToolMessage(
                    content=f"Updated {len(issues)} issues.",
                    tool_call_id=runtime.tool_call_id,
                )
            ],
        }
    )


@tool
def get_issues(runtime: ToolRuntime) -> list[Issue]:
    """
    Get the current issues on the board.
    """
    state_issues = runtime.state.get("issues") if runtime.state else None
    if state_issues is None:
        return _seed_issues()
    return state_issues


@tool
def propose_issue_change(
    issue_id: str,
    changes: dict,
    runtime: ToolRuntime,
) -> str:
    """
    Propose a change to a single issue and ask the user to approve it.

    After calling this, the model MUST call the frontend HITL tool
    `proposeIssueMutation` with the same {issueId, changes} payload. The user
    will see an in-chat Accept / Reject / Edit card. If accepted, the
    frontend applies the change directly to agent state — you do NOT need to
    follow up with manage_issues.

    `changes` is a partial Issue dict:
        {"status": "Done"}
        {"assignee": "Priya", "priority": "High"}
        {"title": "New title"}

    Use this for single-issue edits. For bulk changes (sprint planning,
    importing from a PDF), use manage_issues directly.
    """
    return (
        f"Recorded a proposed change to {issue_id}: {changes}. "
        f"Now call the proposeIssueMutation frontend tool with "
        f"issueId='{issue_id}' and changes={changes!r} so the user can "
        "approve, edit, or reject it in chat."
    )


issue_tools = [
    manage_issues,
    get_issues,
    propose_issue_change,
]
