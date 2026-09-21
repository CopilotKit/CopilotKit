"""Verify native Agno revenue registration and the canonical chart payload."""

import json
from pathlib import Path

from agno.tools.function import Function
from agents.main import agent


def test_native_revenue_tool_matches_canonical_resource():
    functions = [
        item
        for item in agent.tools
        if isinstance(item, Function) and item.name == "get_revenue_chart"
    ]
    assert len(functions) == 1
    function = functions[0]
    assert function.parameters["properties"] == {}
    assert not function.parameters.get("required")
    assert not function.external_execution
    assert function.entrypoint is not None
    result = json.loads(function.entrypoint())
    canonical = Path(__file__).resolve().parents[2] / "data" / "revenue-chart.json"
    assert result == json.loads(canonical.read_text(encoding="utf-8"))
    assert len(result["data"]) == 6
    assert all(type(point["value"]) in (int, float) for point in result["data"])
