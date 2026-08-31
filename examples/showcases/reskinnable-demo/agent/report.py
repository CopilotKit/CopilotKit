"""Deterministic A2UI op-builder + ``render_report`` tool for the banking canvas.

Python port of ``src/skins/banking/build-report-ops.ts`` and of the
``render_report`` ``defineTool`` in ``src/skins/banking/agent.ts``. This module is
intentionally standalone — it imports nothing else from ``agent/`` — so it can be
dropped into any LangGraph/LangChain agent that wants the banking report canvas.

What an A2UI operation is
-------------------------
A2UI (v0.9) describes a *surface*: a server-declared UI region the client renders
from a catalog of components it already ships. An operation list is a small
sequence of envelopes, each carrying a ``version`` plus exactly one operation
body:

* ``createSurface`` — open surface ``surfaceId``, rendered against ``catalogId``.
* ``updateComponents`` — replace the surface's flat component list. Components are
  a flat array of ``{id, component, ...props}`` records wired together by id: the
  root is always ``id: "root"`` and every container names its ``children`` by id.

No data travels in the operations. ``StatCard`` / ``Chart`` / ``Transactions``
bind LIVE client data through ``useReportData()`` in the catalog renderers, so the
agent supplies only metric/kind selections and label-only text. That is why the
title/summary descriptions below forbid figures: a number in a label would be the
model's guess sitting next to real ledger data.

Why the builder is deterministic
--------------------------------
The reasoning model picks only WHAT to show — a title plus which KPIs and charts —
and this module expands that tiny selection into the verbose component JSON. The
model must NEVER author the component JSON itself: hand-written A2UI from an LLM
is slow to stream, easy to get subtly wrong (bad ids, unknown components, dangling
children), and unreviewable. Keeping the expansion in code is what makes the
canvas fast and reliable, and it means the only thing that can be wrong is the
selection.

The ``a2ui_operations`` contract with the middleware
---------------------------------------------------
CopilotKit's A2UI middleware watches the AG-UI event stream. On a
``TOOL_CALL_RESULT`` it parses the result content and looks for the key
``a2ui_operations``; if it finds an array there it converts it into an
``a2ui-surface`` activity, which the shared canvas hands to the banking skin's
``CanvasSurface``. The middleware inspects EVENTS only and does not care which
process produced them, so a remote Python agent works identically to the built-in
TypeScript one — provided the tool result is structurally identical: same key,
same operation envelopes, same ``version`` fields, same surfaceId scheme.

``render_report`` therefore returns a plain ``dict``. LangGraph's tool node
JSON-encodes a non-string tool return into the ``ToolMessage`` content, so the
key survives into the ``TOOL_CALL_RESULT`` payload the middleware parses.
"""

from __future__ import annotations

import uuid
from typing import Any, Literal, Optional, get_args

from langchain.tools import tool
from pydantic import BaseModel, Field

# Must match the middleware's A2UI_OPERATIONS_KEY so its result parser detects it.
A2UI_OPERATIONS_KEY = "a2ui_operations"

SURFACE_ID = "spend-report"

# Mirrors CATALOG_ID in src/skins/banking/catalog/definitions.ts. Kept as a
# literal because this module must not import TypeScript; if the catalog id ever
# changes there, change it here too or the client renders an unknown catalog.
CATALOG_ID = "https://cpk-a2ui.local/catalogs/banking/v1"

A2UI_VERSION = "v0.9"

ReportMetric = Literal[
    "totalSpend",
    "pendingCount",
    "overLimitCount",
    "policyCount",
]
REPORT_METRICS: tuple[str, ...] = get_args(ReportMetric)

ReportChart = Literal[
    "spendingTrend",
    "budgetUsage",
    "spendBreakdown",
    "incomeVsExpenses",
]
REPORT_CHARTS: tuple[str, ...] = get_args(ReportChart)

ReportTxStatus = Literal["all", "pending", "approved", "denied"]
REPORT_TX_STATUSES: tuple[str, ...] = get_args(ReportTxStatus)

# Human captions for each KPI — assigned here so the agent needn't supply them.
METRIC_LABELS: dict[str, str] = {
    "totalSpend": "Total approved spend",
    "pendingCount": "Pending approvals",
    "overLimitCount": "Over limit",
    "policyCount": "Expense policies",
}


class RenderReportSpec(BaseModel):
    """Parameters for the render_report tool (kept intentionally small)."""

    title: str = Field(
        description=(
            "Short report title, e.g. 'Q2 Spend Report'. LABEL ONLY — no figures, "
            "amounts, percentages, or trend claims."
        ),
    )
    kpis: list[ReportMetric] = Field(
        description=(
            "Which KPI stat cards to show, in order. Pick those relevant to the "
            "question."
        ),
    )
    charts: list[ReportChart] = Field(
        description="Which charts to show, in order.",
    )
    transactions: Optional[ReportTxStatus] = Field(
        default=None,
        description=(
            "Include a live transactions table filtered by status: 'all', "
            "'pending', 'approved', or 'denied'. Omit to leave it out."
        ),
    )
    summary: Optional[str] = Field(
        default=None,
        description=(
            "Optional one-line NEUTRAL caption under the title. Label-only — no "
            "figures, amounts, percentages, or trends."
        ),
    )


def new_surface_id(base: str = SURFACE_ID) -> str:
    """Mint a unique surfaceId so a dismissed report never suppresses a later one.

    The canvas remembers the surfaceId the user dismissed, so every report needs
    its own. The suffix is a uuid4 fragment rather than a timestamp (two reports
    in the same millisecond would collide, and a clock makes output
    non-reproducible in tests and recorded fixtures) and rather than a
    process-local counter (which restarts at 1 on every reload and runs
    independently in each worker process, so it can re-issue an id the browser
    already has marked dismissed — the exact bug the unique suffix exists to
    prevent). uuid4 is unique across processes, restarts and workers.
    """
    return f"{base}-{uuid.uuid4().hex[:8]}"


def build_report_ops(
    spec: RenderReportSpec,
    surface_id: str = SURFACE_ID,
) -> list[dict[str, Any]]:
    """Expand a report selection into A2UI v0.9 operations.

    Returns ``createSurface`` + ``updateComponents`` (flat components, root id
    "root"), structurally identical to the TypeScript ``buildReportOps``.
    """
    components: list[dict[str, Any]] = []
    root_children: list[str] = []

    components.append({"id": "heading", "component": "Heading", "text": spec.title})
    root_children.append("heading")

    if spec.summary:
        components.append(
            {
                "id": "summary",
                "component": "Text",
                "text": spec.summary,
                "tone": "muted",
            }
        )
        root_children.append("summary")

    if spec.kpis:
        kpi_ids: list[str] = []
        for metric in spec.kpis:
            component_id = f"kpi-{metric}"
            components.append(
                {
                    "id": component_id,
                    "component": "StatCard",
                    "metric": metric,
                    "label": METRIC_LABELS[metric],
                }
            )
            kpi_ids.append(component_id)
        components.append(
            {
                "id": "kpi-grid",
                "component": "Grid",
                "columns": min(len(spec.kpis), 4),
                "children": kpi_ids,
            }
        )
        root_children.append("kpi-grid")

    if spec.charts:
        chart_ids: list[str] = []
        for kind in spec.charts:
            component_id = f"chart-{kind}"
            components.append({"id": component_id, "component": "Chart", "kind": kind})
            chart_ids.append(component_id)
        components.append(
            {
                "id": "chart-grid",
                "component": "Grid",
                "columns": 2 if len(spec.charts) >= 2 else 1,
                "children": chart_ids,
            }
        )
        root_children.append("chart-grid")

    if spec.transactions:
        components.append(
            {
                "id": "transactions",
                "component": "Transactions",
                "status": spec.transactions,
            }
        )
        root_children.append("transactions")

    components.insert(
        0,
        {
            "id": "root",
            "component": "Stack",
            "gap": "lg",
            "children": root_children,
        },
    )

    return [
        {
            "version": A2UI_VERSION,
            "createSurface": {"surfaceId": surface_id, "catalogId": CATALOG_ID},
        },
        {
            "version": A2UI_VERSION,
            "updateComponents": {"surfaceId": surface_id, "components": components},
        },
    ]


def extract_surface_id(ops: list[dict[str, Any]]) -> Optional[str]:
    """Read the surfaceId out of an A2UI operation list (any op kind)."""
    for op in ops:
        target = (
            op.get("createSurface")
            or op.get("updateComponents")
            or op.get("updateDataModel")
        )
        if isinstance(target, dict) and target.get("surfaceId"):
            return target["surfaceId"]
    return None


@tool("render_report", args_schema=RenderReportSpec)
def render_report(
    title: str,
    kpis: list[str],
    charts: list[str],
    transactions: Optional[str] = None,
    summary: Optional[str] = None,
) -> dict[str, Any]:
    """Render a multi-widget spend report on the CANVAS (the app's main content area, outside the chat). Choose which KPIs and charts to include; the client renders live banking figures — you never pass numbers. Use for a report/overview/dashboard/analysis request or 'show it on the canvas', NOT for a single inline chart."""
    spec = RenderReportSpec(
        title=title,
        kpis=kpis,
        charts=charts,
        transactions=transactions,
        summary=summary,
    )
    # Unique surfaceId per report so dismissing one report never suppresses a
    # later one (the canvas tracks the dismissed surfaceId).
    return {A2UI_OPERATIONS_KEY: build_report_ops(spec, new_surface_id())}
