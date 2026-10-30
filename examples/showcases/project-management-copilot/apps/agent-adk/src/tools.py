"""
Tool surface for the ADK PM-copilot. Mirrors apps/agent/src/issues.py +
analysis.py — same names so the frontend doesn't care which backend is
wired in.

ADK uses plain Python functions as tools; type hints + the docstring drive
the schema the model sees.
"""

import asyncio
import json
import uuid
from typing import Any

from .issues_data import seed_issues


# State is held in module-scope keyed by thread/session id. The ADK bridge
# emits its own STATE_DELTA / STATE_SNAPSHOT events; the kanban issues live
# in this dict and we re-emit them as needed.
#
# This intentionally mirrors the agent-state pattern (state lives in the
# agent) so the frontend's useAgent() works the same way.
_THREAD_STATE: dict[str, dict[str, Any]] = {}


def _state_for(thread_id: str) -> dict[str, Any]:
    if thread_id not in _THREAD_STATE:
        _THREAD_STATE[thread_id] = {"issues": seed_issues()}
    return _THREAD_STATE[thread_id]


def get_issues(thread_id: str = "default") -> str:
    """Return the current issues on the kanban board as a JSON string."""
    return json.dumps(_state_for(thread_id)["issues"])


def manage_issues(issues_json: str, thread_id: str = "default") -> str:
    """
    Replace the entire issue list. `issues_json` is a JSON string of
    Issue dicts. Use for bulk operations (sprint planning, PDF imports).

    For single edits, prefer propose_issue_change so the user can approve
    in the chat UI.
    """
    try:
        issues = json.loads(issues_json)
    except json.JSONDecodeError as e:
        return f"Invalid issues_json: {e}"
    for issue in issues:
        if "id" not in issue or not issue["id"]:
            issue["id"] = f"ISS-{str(uuid.uuid4())[:8]}"
        issue.setdefault("status", "Backlog")
        issue.setdefault("priority", "Med")
        issue.setdefault("labels", [])
        issue.setdefault("description", "")
    _state_for(thread_id)["issues"] = issues
    return f"Updated {len(issues)} issues."


def propose_issue_change(issue_id: str, changes_json: str) -> str:
    """
    Propose a change to a single issue. `changes_json` is a JSON string of
    partial Issue fields (status, priority, assignee, etc.).

    The model MUST follow up with the frontend's proposeIssueMutation tool
    so the user can approve, edit, or reject in chat.
    """
    return (
        f"Proposed change to {issue_id}: {changes_json}. "
        f"Now call the proposeIssueMutation frontend tool with issueId="
        f"'{issue_id}' and changes={changes_json} to surface the approval card."
    )


def analyze_backlog(focus: str, thread_id: str = "default") -> str:
    """
    Walk through the backlog with focus on `focus` (e.g. "what's blocking
    ship?", "prioritize next sprint"). Returns a short summary.

    NOTE: in the LangGraph implementation this emits progress steps via
    copilotkit_emit_state; the ADK side here just returns the final summary
    since the AG-UI bridge handles event translation differently. The
    timeline panel still renders any STATE_DELTA events the bridge emits.
    """
    state = _state_for(thread_id)
    issues = state["issues"]
    urgent = [i for i in issues if i.get("priority") == "Urgent"]
    high = [i for i in issues if i.get("priority") == "High"]
    by_status: dict[str, int] = {}
    for i in issues:
        s = i.get("status", "Backlog")
        by_status[s] = by_status.get(s, 0) + 1

    parts = []
    if urgent:
        parts.append(
            f"{len(urgent)} urgent: " + ", ".join(i.get("id", "?") for i in urgent[:5])
        )
    if high:
        parts.append(
            f"{len(high)} high: " + ", ".join(i.get("id", "?") for i in high[:5])
        )
    parts.append(
        "Status: " + ", ".join(f"{k}={v}" for k, v in by_status.items())
    )
    return f"Focus={focus!r}. " + " | ".join(parts)
