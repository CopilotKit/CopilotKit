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
    from ag_ui_adk.a2ui_google_sdk import create_express_processor
    from ag_ui_adk._vendor.a2ui.parser import A2uiPart

    for fixture in express:
        processor = create_express_processor(
            catalog,
            default_catalog_id=catalog["catalogId"],
            surface_id="dynamic-surface",
        )
        parts = processor.parse_response(fixture["response"]["content"])
        assert sum(isinstance(part, A2uiPart) for part in parts) == 2
        assert fixture["chunkSize"] < len(fixture["response"]["content"])


def test_raw_recovery_fixtures_reject_bad_blocks_and_compile_the_repair():
    import json
    from pathlib import Path
    import pytest
    from ag_ui_adk.a2ui_google_sdk import create_express_processor
    from ag_ui_adk._vendor.a2ui.core import A2uiError

    integration = Path(__file__).resolve().parents[2]
    catalog = json.loads(
        (
            integration / "src/agents/a2ui_schemas/declarative_catalog.generated.json"
        ).read_text()
    )
    fixtures = json.loads(
        (integration.parents[1] / "aimock/d6/google-adk/a2ui-recovery.json").read_text()
    )["fixtures"]
    express = [fixture for fixture in fixtures if "systemMessage" in fixture["match"]]
    assert len(express) == 3
    for fixture in express:
        processor = create_express_processor(
            catalog,
            default_catalog_id=catalog["catalogId"],
            surface_id="dynamic-surface",
        )
        source = fixture["response"]["content"]
        if "UnknownDashboard" in source:
            with pytest.raises(A2uiError):
                processor.parse_response(source)
        else:
            assert fixture["match"]["sequenceIndex"] == 1
            assert len(processor.parse_response(source)) >= 2
