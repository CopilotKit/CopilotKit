"""Real shared revenue handler and Langroid registration contracts."""

import json
import logging
from pathlib import Path

import pytest

import agents.agent as agent_module
import tools.get_revenue_chart as revenue_resource
from agents.agui_adapter import _TOOL_BY_NAME
from tools import get_revenue_chart_impl


@pytest.fixture
def revenue_tool():
    return next(
        tool
        for tool in agent_module.BACKEND_TOOLS
        if tool.default_value("request") == "get_revenue_chart"
    )


def test_registered_revenue_tool_returns_shared_renderer_contract(revenue_tool):
    assert _TOOL_BY_NAME["get_revenue_chart"] is revenue_tool
    assert revenue_tool not in agent_module.FRONTEND_TOOLS
    assert json.loads(revenue_tool().handle()) == get_revenue_chart_impl()


def test_revenue_tool_reports_missing_resource(
    revenue_tool, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog
):
    monkeypatch.setattr(
        revenue_resource, "_REVENUE_CHART_PATH", tmp_path / "missing.json"
    )
    with caplog.at_level(logging.ERROR, logger="agents.agent"):
        result = json.loads(revenue_tool().handle())
    assert result["error"] == "get_revenue_chart_failed"
    assert "FileNotFoundError" in result["message"]
    assert "GetRevenueChartTool.handle failed" in caplog.text


def test_revenue_tool_reports_serialization_failure(
    revenue_tool, monkeypatch: pytest.MonkeyPatch, caplog
):
    def reject_chart(value: object) -> str:
        if isinstance(value, dict) and "data" in value:
            raise TypeError("chart serialization failed")
        return json.dumps(value)

    monkeypatch.setattr(agent_module, "_json_dumps", reject_chart)
    with caplog.at_level(logging.ERROR, logger="agents.agent"):
        result = json.loads(revenue_tool().handle())
    assert result == {
        "error": "get_revenue_chart_failed",
        "message": "TypeError: chart serialization failed",
    }
    assert "GetRevenueChartTool.handle failed" in caplog.text
