"""The authored Express flight tree must compile to the existing JSON tree."""

from agents.a2ui_fixed_agent import _build_flight_operations, FLIGHT_SCHEMA


def test_express_fixed_tree_matches_direct_json_and_keeps_runtime_bindings():
    values = dict(origin="SFO", destination="JFK", airline="United", price="$289")
    direct = _build_flight_operations(**values)
    express = _build_flight_operations(**values, inference_format="express")
    direct_components = next(
        op["updateComponents"]["components"]
        for op in direct["a2ui_operations"]
        if "updateComponents" in op
    )
    express_components = next(
        op["updateComponents"]["components"]
        for op in express["a2ui_operations"]
        if "updateComponents" in op
    )
    assert sorted(express_components, key=lambda c: c["id"]) == sorted(
        direct_components, key=lambda c: c["id"]
    )
    assert direct_components == FLIGHT_SCHEMA
    assert (
        next(
            op["updateDataModel"]["value"]
            for op in express["a2ui_operations"]
            if "updateDataModel" in op
        )
        == values
    )
    assert len([op for op in express["a2ui_operations"] if "createSurface" in op]) == 1


def test_raw_express_fixtures_use_the_build_exported_frontend_catalog():
    import json
    from pathlib import Path
    from ag_ui_adk import compile_a2ui_express

    integration = Path(__file__).resolve().parents[2]
    catalog = json.loads(
        (
            integration / "src/agents/a2ui_schemas/declarative_catalog.generated.json"
        ).read_text()
    )
    fixtures = json.loads(
        (
            integration.parents[1] / "aimock/d6/google-adk/gen-ui-declarative.json"
        ).read_text()
    )["fixtures"]
    express = [f for f in fixtures if "systemMessage" in f["match"]]
    assert len(express) == 4
    for fixture in express:
        source = (
            fixture["response"]["content"]
            .split("<a2ui>\n", 1)[1]
            .split("</a2ui>", 1)[0]
        )
        operations = compile_a2ui_express(source, catalog=catalog)
        assert any("updateComponents" in op for op in operations)
        assert fixture["chunkSize"] < len(source)
