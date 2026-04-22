"""Schedule meeting tool implementation.

The HITL gating happens on the frontend via useHumanInTheLoop.
This tool just returns a pending approval status for the framework
wrapper to surface.
"""

from __future__ import annotations

from typing import Any

def schedule_meeting_impl(
    reason: str,
    duration_minutes: int = 30,
) -> dict[str, Any]:
    """Schedule a meeting (requires human approval).

    Returns a pending_approval status. The actual gating is done by the
    frontend's useHumanInTheLoop hook — the agent pauses until the user
    approves or rejects.
    """
    return {
        "status": "pending_approval",
        "reason": reason,
        "duration_minutes": duration_minutes,
        "message": (
            f"Meeting request: {reason} ({duration_minutes} min). "
            "Awaiting human approval."
        ),
    }
