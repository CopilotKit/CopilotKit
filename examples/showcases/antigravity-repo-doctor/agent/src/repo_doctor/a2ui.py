"""The A2UI surface for a test run.

Fixed schema: the component tree below never changes, and each run only fills
the data model. The browser renders `TestReport` from its own catalog
(src/a2ui in the Next.js app), and every prop is a `{ path }` binding into that data.

CopilotKit's runtime A2UI middleware finds the `a2ui_operations` key in the
tool result and paints the surface in the chat.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from .test_report import TestReport

# Must match CATALOG_ID in src/a2ui/catalog.tsx (the Next.js app).
CATALOG_ID = "https://repo-doctor.dev/a2ui/catalog/v1"

_BINDINGS = (
    "run",
    "status",
    "headline",
    "command",
    "passed",
    "failed",
    "errors",
    "skipped",
    "durationSeconds",
    "files",
    "failures",
    "summary",
)

COMPONENTS: list[dict[str, Any]] = [
    {
        "id": "root",
        "component": "TestReport",
        **{name: {"path": f"/{name}"} for name in _BINDINGS},
    }
]


def surface_id(run: int) -> str:
    return f"test-run-{run}"


def report_data(report: TestReport, *, run: int) -> dict[str, Any]:
    return {
        "run": run,
        "status": report.status,
        "headline": report.headline(),
        "command": report.command,
        "passed": report.passed,
        "failed": report.failed,
        "errors": report.errors,
        "skipped": report.skipped,
        "durationSeconds": report.duration_seconds,
        "files": [asdict(f) for f in report.files],
        "failures": [asdict(f) for f in report.failures],
        "summary": report.summary,
    }


def report_surface_operations(report: TestReport, *, run: int) -> list[dict[str, Any]]:
    sid = surface_id(run)
    return [
        {"version": "v0.9", "createSurface": {"surfaceId": sid, "catalogId": CATALOG_ID}},
        {"version": "v0.9", "updateComponents": {"surfaceId": sid, "components": COMPONENTS}},
        {
            "version": "v0.9",
            "updateDataModel": {
                "surfaceId": sid,
                "path": "/",
                "value": report_data(report, run=run),
            },
        },
    ]
