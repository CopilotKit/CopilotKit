import json
from pathlib import Path

import pytest

import tools
import tools.get_revenue_chart as revenue_chart
from tools import get_revenue_chart_impl


def test_revenue_payload_matches_gold_renderer_contract():
    result = json.loads(json.dumps(get_revenue_chart_impl()))
    assert result == {
        "title": "Quarterly revenue",
        "subtitle": "Last six months · USD thousands",
        "data": [
            {"label": "Jan", "value": 38},
            {"label": "Feb", "value": 47},
            {"label": "Mar", "value": 52},
            {"label": "Apr", "value": 49},
            {"label": "May", "value": 63},
            {"label": "Jun", "value": 71},
        ],
    }
    assert all(type(point["value"]) in (int, float) for point in result["data"])


def test_results_do_not_share_nested_mutable_state():
    first = get_revenue_chart_impl()
    first["title"] = "Changed"
    first["data"][0]["value"] = 0
    first["data"].pop()

    second = get_revenue_chart_impl()
    assert second["title"] == "Quarterly revenue"
    assert second["data"][0] == {"label": "Jan", "value": 38}
    assert len(second["data"]) == 6


@pytest.fixture
def resource_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "revenue-chart.json"
    monkeypatch.setattr(revenue_chart, "_REVENUE_CHART_PATH", path)
    return path


def test_missing_resource_fails_visibly(resource_path: Path):
    with pytest.raises(FileNotFoundError):
        get_revenue_chart_impl()


def test_malformed_resource_fails_visibly(resource_path: Path):
    resource_path.write_text('{"title":', encoding="utf-8")
    with pytest.raises(json.JSONDecodeError):
        get_revenue_chart_impl()


def test_canonical_barrel_exports_revenue():
    assert "get_revenue_chart_impl" in tools.__all__
    assert tools.get_revenue_chart_impl is revenue_chart.get_revenue_chart_impl
