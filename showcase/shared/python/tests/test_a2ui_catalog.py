"""The host contract, not model prose, controls generated surfaces."""

import json
import sys
from pathlib import Path

import pytest
from ag_ui_a2ui_toolkit import A2UI_SCHEMA_CONTEXT_DESCRIPTION

sys.path.insert(0, str(Path(__file__).parents[1]))
from tools.a2ui_catalog import read_client_catalog, validate_client_surface


@pytest.fixture
def catalog():
    return {
        "catalogId": "copilotkit://customer-catalog",
        "components": {
            "Column": {
                "allOf": [
                    {"$ref": "common_types.json#/$defs/ComponentCommon"},
                    {
                        "properties": {
                            "component": {"const": "Column"},
                            "children": {"type": "array", "items": {"type": "string"}},
                        },
                        "required": ["children"],
                    },
                ]
            },
            "Metric": {
                "properties": {"value": {"type": "number"}},
                "required": ["value"],
            },
        },
    }


@pytest.fixture
def surface(catalog):
    return {
        "catalogId": catalog["catalogId"],
        "surfaceId": "dashboard-1",
        "components": [
            {"id": "root", "component": "Column", "children": ["revenue"]},
            {"id": "revenue", "component": "Metric", "value": 73125},
        ],
    }


def test_uses_exact_host_contract(catalog, surface):
    entries = [
        {"description": A2UI_SCHEMA_CONTEXT_DESCRIPTION, "value": json.dumps(catalog)}
    ]
    assert read_client_catalog(entries) == catalog
    validate_client_surface(surface, catalog)
    assert surface["components"][1]["value"] == 73125


@pytest.mark.parametrize(
    "value", [None, "bad json", "{}", '{"catalogId":"x","components":{}}']
)
def test_missing_or_invalid_catalog_fails(value):
    with pytest.raises(ValueError):
        read_client_catalog(
            [{"description": A2UI_SCHEMA_CONTEXT_DESCRIPTION, "value": value}]
        )


@pytest.mark.parametrize(
    "parts",
    [
        None,
        {"first": {}, "second": {}},
        [{"$ref": "common_types.json#/$defs/ComponentCommon"}, None],
    ],
)
def test_malformed_all_of_returns_catalog_validation_error(catalog, parts):
    catalog["components"]["Column"] = {"allOf": parts}
    entries = [
        {"description": A2UI_SCHEMA_CONTEXT_DESCRIPTION, "value": json.dumps(catalog)}
    ]
    with pytest.raises(ValueError, match="invalid component schema"):
        read_client_catalog(entries)


@pytest.mark.parametrize(
    "mutation",
    [
        lambda s: s.update(catalogId="a2ui_default"),
        lambda s: s.update(components=[]),
        lambda s: s.update(data=[]),
        lambda s: s["components"][1].update(component="InventedChart"),
        lambda s: s["components"][1].update(value="73125"),
        lambda s: s["components"][1].pop("value"),
        lambda s: s["components"][0].update(children=["missing"]),
        lambda s: s["components"][0].update(children=["root"]),
        lambda s: s["components"][1].update(id="root"),
        lambda s: s["components"][0].update(id="not-root"),
    ],
)
def test_invalid_surface_is_rejected(catalog, surface, mutation):
    mutation(surface)
    with pytest.raises(ValueError):
        validate_client_surface(surface, catalog)


def test_separate_requests_do_not_share_catalog(catalog, surface):
    other = {**catalog, "catalogId": "copilotkit://another-host"}
    with pytest.raises(ValueError):
        validate_client_surface(surface, other)
    validate_client_surface(surface, catalog)


def test_rejects_extra_renderer_props(catalog, surface):
    surface["components"][0]["title"] = "Invented layout prop"
    with pytest.raises(ValueError, match="Additional properties"):
        validate_client_surface(surface, catalog)


def test_local_schema_refs_are_resolved_in_component_document(catalog, surface):
    catalog["components"]["Column"]["allOf"][1]["properties"]["label"] = {
        "type": "string"
    }
    catalog["components"]["Column"]["allOf"][1]["properties"]["subtitle"] = {
        "$ref": "#/properties/label"
    }
    surface["components"][0]["subtitle"] = "Revenue"
    validate_client_surface(surface, catalog)
    surface["components"][0]["subtitle"] = 5
    with pytest.raises(ValueError):
        validate_client_surface(surface, catalog)
