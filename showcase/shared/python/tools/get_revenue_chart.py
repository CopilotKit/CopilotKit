"""Shared mock revenue data for showcase chart renderers."""

import json
from pathlib import Path
from typing import TypedDict


class RevenuePoint(TypedDict):
    label: str
    value: int | float


class RevenueChart(TypedDict):
    title: str
    subtitle: str
    data: list[RevenuePoint]


_REVENUE_CHART_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "revenue-chart.json"
)


def get_revenue_chart_impl() -> RevenueChart:
    """Read a fresh six-month chart; missing or malformed data fails visibly."""
    return json.loads(_REVENUE_CHART_PATH.read_text(encoding="utf-8"))
