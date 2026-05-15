"""Regression tests for the v0.9 A2UI operations shape.

`tools/generate_a2ui.py:build_a2ui_operations_from_tool_call` must emit
the v0.9 NESTED operation shape — `{"createSurface": {...}}` /
`{"updateComponents": {...}}` / `{"updateDataModel": {...}}` — not the
legacy v0.8 flat shape (`{"type": "create_surface", "surfaceId": ...}`).

The `@ag-ui/a2ui-middleware` matcher (`getOperationSurfaceId`) walks
ONLY the nested keys. Pre-fix, ADK emitted the flat shape, the matcher
returned undefined for every op, the runtime grouped them under the
`"default"` surface, and the React renderer threw
`Catalog not found: default` or `Component 'undefined' is missing an 'id'`.

These tests pin three properties:
1. Shape (v0.9 nested with `version: "v0.9"`).
2. `_sanitize_a2ui_components` drops entries without `id` + `component`.
3. `_unstringify_json_fields` round-trips Gemini's quirk of emitting
   `"data": "[{...}]"` as a JSON string back to a real array.
"""

from __future__ import annotations

from tools.generate_a2ui import (
    _has_root_component,
    _sanitize_a2ui_components,
    _unstringify_json_fields,
    build_a2ui_operations_from_tool_call,
)


# ---------------------------------------------------------------------------
# Shape: v0.9 nested operations
# ---------------------------------------------------------------------------


def test_build_emits_v09_nested_create_surface():
    args = {
        "surfaceId": "sales-dash",
        "catalogId": "declarative-gen-ui-catalog",
        "components": [{"id": "root", "component": "PieChart"}],
    }
    result = build_a2ui_operations_from_tool_call(args)
    ops = result["a2ui_operations"]
    create = ops[0]
    assert create.get("version") == "v0.9"
    # Nested shape — middleware matcher reads surfaceId from inside the
    # `createSurface` key, not from the top level.
    assert "createSurface" in create
    assert create["createSurface"]["surfaceId"] == "sales-dash"
    assert create["createSurface"]["catalogId"] == "declarative-gen-ui-catalog"
    # Legacy flat shape MUST NOT be present.
    assert "type" not in create
    assert "surfaceId" not in create  # surfaceId is nested, not top-level


def test_build_emits_v09_nested_update_components():
    args = {
        "surfaceId": "s1",
        "catalogId": "c1",
        "components": [
            {"id": "root", "component": "Card", "children": ["a", "b"]},
            {"id": "a", "component": "Metric", "label": "Revenue", "value": "$42k"},
            {"id": "b", "component": "Metric", "label": "Signups", "value": "1200"},
        ],
    }
    result = build_a2ui_operations_from_tool_call(args)
    update = result["a2ui_operations"][1]
    assert update.get("version") == "v0.9"
    assert "updateComponents" in update
    assert update["updateComponents"]["surfaceId"] == "s1"
    assert len(update["updateComponents"]["components"]) == 3


def test_build_emits_v09_update_data_model_with_path_and_value():
    """Per copilotkit.a2ui Python SDK shape, updateDataModel uses
    `path` + `value`, NOT a flat `data` field."""
    args = {
        "surfaceId": "s1",
        "catalogId": "c1",
        "components": [{"id": "root", "component": "PieChart"}],
        "data": {"regions": [{"label": "NA", "value": 45}]},
    }
    result = build_a2ui_operations_from_tool_call(args)
    update_data = result["a2ui_operations"][2]
    assert update_data.get("version") == "v0.9"
    assert "updateDataModel" in update_data
    payload = update_data["updateDataModel"]
    assert payload["surfaceId"] == "s1"
    assert payload["path"] == "/"
    assert payload["value"] == {"regions": [{"label": "NA", "value": 45}]}


def test_build_omits_update_data_model_when_args_have_no_data():
    args = {
        "surfaceId": "s1",
        "catalogId": "c1",
        "components": [{"id": "root", "component": "PieChart"}],
    }
    result = build_a2ui_operations_from_tool_call(args)
    ops = result["a2ui_operations"]
    # Only createSurface + updateComponents — no updateDataModel.
    assert len(ops) == 2
    assert all("updateDataModel" not in op for op in ops)


# ---------------------------------------------------------------------------
# Sanitization: drop empties + missing id/component
# ---------------------------------------------------------------------------


def test_sanitize_drops_empty_objects():
    """Gemini emits `[{}, {}, {}]` when the components schema lacks
    required item fields. The sanitizer must drop them all."""
    raw = [{}, {}, {}]
    assert _sanitize_a2ui_components(raw) == []


def test_sanitize_drops_entries_missing_id():
    raw = [
        {"component": "Card"},  # missing id
        {"id": "root", "component": "Card"},
    ]
    out = _sanitize_a2ui_components(raw)
    assert len(out) == 1
    assert out[0]["id"] == "root"


def test_sanitize_drops_entries_missing_component():
    raw = [
        {"id": "root"},  # missing component
        {"id": "x", "component": "Metric"},
    ]
    out = _sanitize_a2ui_components(raw)
    assert len(out) == 1
    assert out[0]["component"] == "Metric"


def test_sanitize_passes_through_well_formed_entries():
    raw = [
        {"id": "root", "component": "PieChart"},
        {"id": "legend", "component": "Legend"},
    ]
    out = _sanitize_a2ui_components(raw)
    assert len(out) == 2


def test_sanitize_returns_empty_for_non_list_input():
    """LLM occasionally returns the components arg as a string when the
    schema item type is loose. Don't crash — return empty so the caller
    logs a warning and the renderer doesn't error."""
    assert _sanitize_a2ui_components("not a list") == []
    assert _sanitize_a2ui_components(None) == []
    assert _sanitize_a2ui_components({"id": "root"}) == []


def test_has_root_component_true_when_root_id_present():
    components = [
        {"id": "root", "component": "Card"},
        {"id": "leaf", "component": "Metric"},
    ]
    assert _has_root_component(components) is True


def test_has_root_component_false_when_no_root_id():
    components = [
        {"id": "header", "component": "Title"},
        {"id": "body", "component": "Card"},
    ]
    assert _has_root_component(components) is False


# ---------------------------------------------------------------------------
# Unstringify: Gemini emits `"data": "[{...}]"` (string) — must end up array
# ---------------------------------------------------------------------------


def test_unstringify_parses_json_array_string():
    component = {
        "id": "root",
        "component": "PieChart",
        "data": '[{"label": "NA", "value": 45}, {"label": "EMEA", "value": 30}]',
    }
    out = _unstringify_json_fields(component)
    assert isinstance(out["data"], list)
    assert out["data"][0] == {"label": "NA", "value": 45}


def test_unstringify_parses_json_object_string():
    component = {
        "id": "x",
        "component": "Metric",
        "value": '{"amount": 42, "currency": "USD"}',
    }
    out = _unstringify_json_fields(component)
    assert isinstance(out["value"], dict)
    assert out["value"]["amount"] == 42


def test_unstringify_leaves_real_arrays_alone():
    component = {
        "id": "root",
        "component": "PieChart",
        "data": [{"label": "NA", "value": 45}],
    }
    out = _unstringify_json_fields(component)
    assert out["data"] == [{"label": "NA", "value": 45}]


def test_unstringify_leaves_plain_strings_alone():
    """Non-JSON string fields (like `label`, `text`) must not be touched."""
    component = {
        "id": "x",
        "component": "Metric",
        "label": "Revenue",
        "value": "$42k",  # not JSON-shaped, leave as-is
    }
    out = _unstringify_json_fields(component)
    assert out["label"] == "Revenue"
    assert out["value"] == "$42k"


def test_unstringify_leaves_malformed_json_as_string():
    """If `data` looks JSON-ish but doesn't parse, leave the string in place
    so the renderer at least receives a defined value instead of nothing."""
    component = {
        "id": "root",
        "component": "PieChart",
        "data": "[malformed json",
    }
    out = _unstringify_json_fields(component)
    assert out["data"] == "[malformed json"


def test_sanitize_unstringifies_data_field_end_to_end():
    """The full sanitize path drops empties AND unstringifies in one pass."""
    raw = [
        {},  # dropped
        {
            "id": "root",
            "component": "PieChart",
            "data": '[{"label": "Asia", "value": 25}]',
        },
        {"id": "no-component"},  # dropped
    ]
    out = _sanitize_a2ui_components(raw)
    assert len(out) == 1
    assert out[0]["data"] == [{"label": "Asia", "value": 25}]
