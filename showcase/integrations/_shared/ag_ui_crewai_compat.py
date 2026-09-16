"""Narrow compatibility fixes for the pinned AG-UI CrewAI bridge."""

from __future__ import annotations

from importlib.metadata import version as package_version
from typing import Any

import ag_ui_crewai._hitl as bridge_hitl
import ag_ui_crewai.endpoint as bridge_endpoint


_SUPPORTED_VERSION = "0.3.0"
_original_feedback_from_resume = bridge_hitl.feedback_from_resume


def _feedback_from_resume(input_data: Any) -> tuple[str, str | None]:
    feedback, interrupt_id = _original_feedback_from_resume(input_data)
    entries = list(getattr(input_data, "resume", None) or [])
    if entries:
        entry = entries[0]
        if (
            getattr(entry, "status", None) == "resolved"
            and getattr(entry, "payload", None) is None
        ):
            # ag-ui-crewai 0.3.0 otherwise maps this and cancellation to "".
            # JSON null keeps CrewAI's string feedback API unambiguous.
            feedback = "null"
    return feedback, interrupt_id


def install_resume_status_compat() -> None:
    """Preserve resolved-null status until the bridge exposes it natively."""

    installed_version = package_version("ag-ui-crewai")
    if installed_version != _SUPPORTED_VERSION:
        raise RuntimeError(
            "The resume-status compatibility shim supports ag-ui-crewai "
            f"{_SUPPORTED_VERSION}, but {installed_version} is installed. "
            "Revalidate the upstream resume mapping before updating the pin."
        )

    # The endpoint module captured the private helper at import time, so both
    # bindings must point at the same version-scoped wrapper.
    bridge_hitl.feedback_from_resume = _feedback_from_resume
    bridge_endpoint.feedback_from_resume = _feedback_from_resume
