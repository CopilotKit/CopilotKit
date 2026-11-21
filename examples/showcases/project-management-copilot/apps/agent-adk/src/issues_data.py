"""
Seed data — mirrors apps/agent/src/issues.py so the ADK agent and LangGraph
agent see the same kanban.
"""

from typing import TypedDict, Literal, Optional


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


def seed_issues() -> list[Issue]:
    return [
        {
            "id": "ISS-101",
            "title": "Payment integration flaky on Safari",
            "description": "Customers on Safari 17 see Stripe Elements fail to mount.",
            "status": "In Progress",
            "priority": "Urgent",
            "assignee": "Alex",
            "labels": ["bug", "payments"],
            "dueDate": "2026-05-22",
        },
        {
            "id": "ISS-102",
            "title": "Q3 roadmap kickoff",
            "description": "Pull together candidate themes for Q3.",
            "status": "Todo",
            "priority": "High",
            "assignee": "Sarah",
            "labels": ["planning"],
            "dueDate": "2026-05-24",
        },
        {
            "id": "ISS-103",
            "title": "Migrate auth middleware off legacy session store",
            "description": "Cut the last path over to the JWT flow.",
            "status": "In Review",
            "priority": "High",
            "assignee": "Jordan",
            "labels": ["infra", "tech-debt"],
            "dueDate": "2026-05-20",
        },
        {
            "id": "ISS-107",
            "title": "Postgres connection pool exhaustion at peak",
            "description": "Pool fills at peak weekday traffic.",
            "status": "In Progress",
            "priority": "Urgent",
            "assignee": "Jordan",
            "labels": ["infra", "performance"],
        },
        {
            "id": "ISS-118",
            "title": "Bug: Slack notifications duplicate on retry",
            "description": "Retry middleware does not dedupe webhook calls.",
            "status": "In Progress",
            "priority": "High",
            "assignee": "Alex",
            "labels": ["bug", "integrations"],
        },
    ]
