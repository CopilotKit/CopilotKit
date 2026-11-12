import copy
import json

import pytest

from copilotkit_runtime.a2ui import SCHEMA_DESCRIPTION
from copilotkit_runtime.a2ui_upgrade import (
    A2UIV09ActivityUpgrader,
    apply_json_patch,
    args_schema_from_signature,
    build_v09_catalog_context,
    downgrade_v09_action,
    prepare_v09_agent_input,
    upgrade_v09_operations,
)

BASIC = "https://a2ui.org/specification/v0_9/basic_catalog.json"
STANDARD = "copilotkit/standard@1"

PLAN_V09 = [
    {"version": "v0.9", "createSurface": {"surfaceId": "plans", "catalogId": BASIC}},
    {
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "plans",
            "components": [
                {"id": "root", "component": "Column", "children": ["title", "choose"]},
                {"id": "title", "component": "Text", "text": {"path": "/title"}},
                {
                    "id": "choose",
                    "component": "Button",
                    "child": "label",
                    "action": {"event": {"name": "choose", "context": {"plan": {"path": "/plan"}}}},
                },
            ],
        },
    },
    {"version": "v0.9", "updateDataModel": {"surfaceId": "plans", "path": "/", "value": {}}},
]


def test_v09_operations_convert_to_v10():
    operations, dropped = upgrade_v09_operations(PLAN_V09)
    assert dropped == []
    assert operations == [
        {"version": "1.0", "createSurface": {"surfaceId": "plans", "catalogId": STANDARD}},
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "plans",
                "components": [
                    {"id": "root", "component": "Column", "children": ["title", "choose"]},
                    {"id": "title", "component": "Text", "text": {"@path": "/title"}},
                    {
                        "id": "choose",
                        "component": "Button",
                        "child": "label",
                        "onClick": {
                            "event": {"name": "choose", "context": {"plan": {"@path": "/plan"}}}
                        },
                    },
                ],
            },
        },
        {"version": "1.0", "updateDataModel": {"surfaceId": "plans", "path": "/", "value": {}}},
    ]


def test_basic_catalog_props_take_their_standard_catalog_form():
    components = [
        {"id": "h", "component": "Text", "variant": "h1", "weight": "bold", "text": "T"},
        {"id": "c", "component": "Text", "variant": "caption", "weight": "bold", "text": "c"},
        {"id": "b", "component": "Text", "variant": "body", "text": "b"},
        {
            "id": "f",
            "component": "TextField",
            "value": {"path": "/email"},
            "validationRegexp": "@",
        },
        {"id": "n", "component": "Text", "text": {"call": "formatNumber", "args": {"value": 1}}},
    ]
    [operation], _ = upgrade_v09_operations(
        [{"updateComponents": {"surfaceId": "s", "components": components}}]
    )
    assert operation["updateComponents"]["components"] == [
        {"id": "h", "component": "Title", "text": "T", "size": "2xl"},
        {"id": "c", "component": "Caption", "text": "c"},
        {"id": "b", "component": "Text", "text": "b"},
        {
            "id": "f",
            "component": "TextField",
            "value": {"@path": "/email"},
            "checks": [
                {
                    "condition": {
                        "@call": "regex",
                        "args": {"value": {"@path": "/email"}, "pattern": "@"},
                    }
                }
            ],
        },
        {"id": "n", "component": "Text", "text": {"@call": "formatNumber", "args": {"value": 1}}},
    ]


def test_left_out_values_remove_and_unconvertible_operations_are_dropped():
    operations, dropped = upgrade_v09_operations(
        [
            {"version": "v0.9", "updateDataModel": {"surfaceId": "s", "path": "items"}},
            {"version": "v0.9", "updateDataModel": {"surfaceId": "s"}},
            {"version": "1.0", "deleteSurface": {"surfaceId": "s"}},
            {"version": "v0.8", "deleteSurface": {"surfaceId": "s"}},
            {"version": "v0.9", "updateDataModel": {"surfaceId": "s", "path": "/", "value": 3}},
            {
                "version": "v0.9",
                "updateComponents": {"surfaceId": "s", "components": [{"id": "x"}]},
            },
        ]
    )
    assert [operation["updateDataModel"] for operation in operations[:2]] == [
        {"surfaceId": "s", "path": "/items", "value": None},
        {"surfaceId": "s", "path": "/", "value": {}},
    ]
    assert operations[2] == {"version": "1.0", "deleteSurface": {"surfaceId": "s"}}
    assert [reason for _, reason in dropped] == [
        'unsupported A2UI version "v0.8"; only v0.9 and 1.0 operations are supported',
        "a root updateDataModel value must be a JSON object in A2UI 1.0",
        'component "x": the component type must be a string (the v0.9 flat format)',
    ]


def activity(message_id, operations, kind="ACTIVITY_SNAPSHOT"):
    return {
        "type": kind,
        "messageId": message_id,
        "activityType": "a2ui-surface",
        "content": {"a2ui_operations": operations},
        "replace": True,
    }


def test_upgrader_sends_one_cumulative_surface_per_surface_id():
    upgrader = A2UIV09ActivityUpgrader()
    assert upgrader.transform({**activity("m", []), "content": {"status": "building"}}) == []
    [first] = upgrader.transform(activity("m", PLAN_V09[:2]))
    assert first["messageId"] == "genui:plans"
    assert first["content"]["status"] == "ready"
    assert first["content"]["a2uiSourceVersion"] == "0.9"
    patch = [{"op": "add", "path": "/a2ui_operations/-", "value": PLAN_V09[2]}]
    [second] = upgrader.transform(
        {"type": "ACTIVITY_DELTA", "messageId": "m", "activityType": "a2ui-surface", "patch": patch}
    )
    assert len(second["content"]["operations"]) == 3
    # Unchanged content is not sent again; a patch that does not apply is skipped.
    assert upgrader.transform(activity("m", [*PLAN_V09[:2], PLAN_V09[2]])) == []
    bad = [{"op": "replace", "path": "/missing/x", "value": 1}]
    assert upgrader.transform({**activity("m", []), "type": "ACTIVITY_DELTA", "patch": bad}) == []
    other = {"type": "ACTIVITY_SNAPSHOT", "activityType": "mcp-apps", "content": {}}
    assert upgrader.transform(other) == [other]


def test_upgrader_shows_a_failed_lifecycle_snapshot_as_an_error_surface_once():
    upgrader = A2UIV09ActivityUpgrader()

    def lifecycle(message_id, content):
        return upgrader.transform({**activity(message_id, []), "content": content})

    assert lifecycle("a2ui-surface-call1", {"status": "retrying", "attempt": 2}) == []
    failed = {"status": "failed", "error": "root is missing", "attempts": []}
    assert lifecycle("a2ui-surface-call1", failed) == [
        {
            "type": "ACTIVITY_SNAPSHOT",
            "messageId": "genui:a2ui-surface-call1",
            "activityType": "generative-ui-surface",
            "content": {
                "surfaceId": "a2ui-surface-call1",
                "target": "chat",
                "catalogId": STANDARD,
                "operations": [],
                "status": "error",
                "rejected": [{"index": 0, "reason": "root is missing"}],
                "a2uiSourceVersion": "0.9",
            },
            "replace": True,
        }
    ]
    assert lifecycle("a2ui-surface-call1", failed) == []
    [long] = lifecycle("a2ui-surface-call2", {"status": "failed", "error": "x" * 600})
    assert len(long["content"]["rejected"][0]["reason"]) == 500
    [generic] = lifecycle("a2ui-surface-call3", {"status": "failed"})
    assert generic["content"]["rejected"] == [{"index": 0, "reason": "A2UI generation failed"}]


def test_upgrader_appends_updates_of_a_surface_from_an_earlier_run():
    upgrader = A2UIV09ActivityUpgrader()
    update = {"version": "v0.9", "updateDataModel": {"surfaceId": "old", "path": "/a", "value": 1}}
    [delta] = upgrader.transform(
        activity("m", [update, {"updateComponents": {"surfaceId": "old"}}])
    )
    assert delta["type"] == "ACTIVITY_DELTA"
    assert delta["messageId"] == "genui:old"
    assert delta["patch"] == [
        {
            "op": "add",
            "path": "/operations/-",
            "value": {
                "version": "1.0",
                "updateDataModel": {"surfaceId": "old", "path": "/a", "value": 1},
            },
        },
        {
            "op": "replace",
            "path": "/rejected",
            "value": [
                {"index": 1, "reason": "updateComponents.components must be a non-empty array"}
            ],
        },
    ]


V10_BASIC = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
# The native 1.0 operations of an ADK agent: the fixture of #8353, from ag-ui #3374
# `test_a2ui_protocol_versions.py::_ops` at 89a59e1.
ADK_V10 = [
    {"version": "1.0", "createSurface": {"surfaceId": "s", "catalogId": V10_BASIC}},
    {
        "version": "1.0",
        "updateComponents": {
            "surfaceId": "s",
            "components": [{"id": "root", "component": "Text", "text": "Hello"}],
        },
    },
    {"version": "1.0", "updateDataModel": {"surfaceId": "s", "path": "/", "value": {}}},
]


def test_native_v10_operations_keep_their_form_on_the_standard_catalog():
    save = {"event": {"name": "save", "context": {"name": {"@path": "/name"}}}}
    native = {
        "version": "1.0",
        "createSurface": {
            "surfaceId": "s",
            "catalogId": V10_BASIC,
            "components": [
                {"id": "title", "component": "Text", "variant": "h2", "text": "Profile"},
                {"id": "save", "component": "Button", "child": "label", "action": save},
            ],
            "dataModel": {"name": "Ada"},
        },
    }
    custom = {
        "version": "1.0",
        "createSurface": {"surfaceId": "c", "catalogId": "https://example.test/catalog"},
    }
    operations, dropped = upgrade_v09_operations([*ADK_V10, native, custom])
    assert dropped == []
    assert operations == [
        {"version": "1.0", "createSurface": {"surfaceId": "s", "catalogId": STANDARD}},
        ADK_V10[1],
        ADK_V10[2],
        {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "s",
                "catalogId": STANDARD,
                "components": [
                    {"id": "title", "component": "Title", "text": "Profile", "size": "xl"},
                    {"id": "save", "component": "Button", "child": "label", "onClick": save},
                ],
                "dataModel": {"name": "Ada"},
            },
        },
        custom,
    ]


def test_upgrader_sends_a_native_v10_surface_without_the_v09_tag():
    upgrader = A2UIV09ActivityUpgrader()
    v09 = {"version": "v0.9", "updateDataModel": {"surfaceId": "s", "path": "/x", "value": 1}}
    [event] = upgrader.transform(activity("m", [*ADK_V10, v09]))
    assert event["messageId"] == "genui:s"
    assert event["activityType"] == "generative-ui-surface"
    assert event["content"] == {
        "surfaceId": "s",
        "target": "chat",
        "catalogId": STANDARD,
        "operations": upgrade_v09_operations(ADK_V10)[0],
        "status": "ready",
        "rejected": [
            {
                "index": 3,
                "reason": 'surface "s" is A2UI 1.0; an A2UI 0.9 operation cannot change it',
            }
        ],
    }
    # A v0.9 surface rejects a 1.0 operation the same way, and keeps its tag.
    native = {"version": "1.0", "deleteSurface": {"surfaceId": "plans"}}
    [converted] = A2UIV09ActivityUpgrader().transform(activity("m", [PLAN_V09[0], native]))
    assert converted["content"]["a2uiSourceVersion"] == "0.9"
    assert converted["content"]["rejected"] == [
        {
            "index": 1,
            "reason": 'surface "plans" is A2UI 0.9; an A2UI 1.0 operation cannot change it',
        }
    ]


def test_json_patch_applies_rfc6902_operations_and_rejects_bad_paths():
    document = {"a": [1, 2], "b": {"c": 1}}
    result = apply_json_patch(
        document,
        [
            {"op": "add", "path": "/a/1", "value": 9},
            {"op": "remove", "path": "/a/0"},
            {"op": "move", "from": "/b/c", "path": "/d"},
            {"op": "copy", "from": "/d", "path": "/a/-"},
            {"op": "test", "path": "/a", "value": [9, 2, 1]},
        ],
    )
    assert result == {"a": [9, 2, 1], "b": {}, "d": 1}
    for patch in (
        [{"op": "replace", "path": "/x", "value": 1}],
        [{"op": "add", "path": "/__proto__", "value": 1}],
        [{"op": "add", "path": "/a/9", "value": 1}],
        [{"op": "test", "path": "/d", "value": 2}],
    ):
        with pytest.raises(ValueError):
            apply_json_patch(copy.deepcopy(result), patch)


def ui(surfaces=None, action=None, components=None, ids=("shop",)):
    extensions = {
        "copilotkit_format": 3,
        "copilotkit_transport": "tool",
        "copilotkit_targets": [{"id": "chat", "kind": "chat"}],
        "copilotkit_surfaces": surfaces or {},
        "copilotkit_contextSent": False,
    }
    if action:
        extensions["copilotkit_action"] = action
    catalog = {"catalogId": ids[0], "protocolVersion": "1.0", "functions": FUNCTIONS}
    if components is not None:
        catalog["components"] = components
    return {
        "copilotkit": {
            "ui": {
                "1.0": {"supportedCatalogIds": list(ids), "inlineCatalogs": [catalog]},
                "metadata": {"extensions": extensions},
            }
        }
    }


CLICK = {
    "version": "1.0",
    "action": {
        "name": "confirm",
        "surfaceId": "card",
        "sourceComponentId": "button",
        "timestamp": "2026-10-20T10:00:00.000Z",
        "context": {"selected": 2},
    },
}
USER_ACTION = {
    "name": "confirm",
    "surfaceId": "card",
    "sourceComponentId": "button",
    "context": {"selected": 2},
    "timestamp": "2026-10-20T10:00:00.000Z",
}
HISTORY = [
    {"id": "1", "role": "user", "content": "Hi"},
    {"id": "2", "role": "user", "content": "Ok"},
]


def test_click_reaches_a_v09_agent_as_its_action_without_the_message():
    input = {"messages": HISTORY, "forwardedProps": ui(action=CLICK)}
    original = copy.deepcopy(input)
    agent_input = downgrade_v09_action(input, "0.9")
    assert input == original
    assert agent_input["messages"] == HISTORY[:1]
    assert agent_input["forwardedProps"]["a2uiAction"] == {"userAction": USER_ACTION}
    assert downgrade_v09_action(input, "1.0") is input


@pytest.mark.parametrize(
    ("source", "agent_version", "converted"),
    [("0.9", "1.0", True), ("1.0", "0.9", False)],
)
def test_surface_origin_decides_before_the_agent_version(source, agent_version, converted):
    activity_message = {
        "id": "a",
        "role": "activity",
        "activityType": "generative-ui-surface",
        "content": {"surfaceId": "card", "a2uiSourceVersion": source},
    }
    from_message = {"messages": [activity_message, *HISTORY], "forwardedProps": ui(action=CLICK)}
    from_summary = {
        "messages": HISTORY,
        "forwardedProps": ui(
            action=CLICK, surfaces={"card": {"target": "chat", "a2uiSourceVersion": source}}
        ),
    }
    for input in (from_message, from_summary):
        agent_input = downgrade_v09_action(input, agent_version)
        assert ("a2uiAction" in agent_input["forwardedProps"]) is converted


def test_a_summary_without_the_v09_tag_is_a_v10_surface():
    # A native 1.0 surface: its click reaches even a 0.9 agent unchanged.
    input = {
        "messages": HISTORY,
        "forwardedProps": ui(action=CLICK, surfaces={"card": {"target": "chat"}}),
    }
    assert downgrade_v09_action(input, "0.9") is input


def test_an_existing_v09_action_is_kept():
    forwarded = {**ui(action=CLICK), "a2uiAction": {"userAction": {"name": "old"}}}
    input = {"messages": HISTORY, "forwardedProps": forwarded}
    assert downgrade_v09_action(input, "0.9") is input


FUNCTIONS = {
    "pick": {
        "description": 'Pick with {"@path": "/id"}',
        "parameters": {"type": "object", "properties": {"id": {"type": "string"}}},
    },
    "secret": {"allowedCallers": "agentOnly", "parameters": {"type": "object"}},
}
BUTTON = {
    "props": {"type": "object", "properties": {"label": {"type": "string"}}},
    "events": {"onClick": {"description": "Clicked", "parameters": {}}},
}
TITLE = {"props": {"type": "object", "properties": {"text": {"type": "string"}}}}
CARD = {
    "description": 'Bind with {"@path": "/x"}',
    "props": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Its name"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "size": {"type": "string", "enum": ["sm", "lg"]},
        },
        "required": ["name"],
    },
    "slots": {"footer": "single"},
    "parameterOrder": ["footer"],
}


def schema_of(context):
    return json.loads(next(e["value"] for e in context if e["description"] == SCHEMA_DESCRIPTION))


def test_standard_catalog_becomes_the_basic_catalog_plus_custom_components():
    components = {"Button": BUTTON, "Title": TITLE, "ProductCard": CARD}
    catalog_id, context = build_v09_catalog_context(
        {"forwardedProps": ui(components=components, ids=("app", STANDARD))}
    ) or ("", [])
    assert catalog_id == BASIC
    schema = schema_of(context)
    # Title is a standard component that v0.9 never had; Button keeps its v0.9 prop name.
    assert list(schema["components"]) == ["Button", "ProductCard"]
    button = schema["components"]["Button"]["allOf"][1]
    assert list(button["properties"]) == ["component", "label", "action"]
    card = schema["components"]["ProductCard"]
    assert card["description"] == 'Bind with {"path": "/x"}'
    assert card["allOf"][1]["properties"] == {
        "component": {"const": "ProductCard"},
        "footer": {"$ref": "common_types.json#/$defs/ComponentId"},
        "name": {"$ref": "common_types.json#/$defs/DynamicString", "description": "Its name"},
        "tags": {"$ref": "common_types.json#/$defs/DynamicStringList"},
        "size": {
            "anyOf": [
                {"type": "string", "enum": ["sm", "lg"]},
                {"$ref": "common_types.json#/$defs/DataBinding"},
                {"$ref": "common_types.json#/$defs/FunctionCall"},
            ]
        },
    }
    assert card["allOf"][1]["required"] == ["component", "name"]
    names = [fn["name"] for fn in schema["functions"]]
    assert names[-1] == "pick" and "secret" not in names and "calc" not in names
    assert next(fn for fn in schema["functions"] if fn["name"] == "email")["returnType"] == (
        "boolean"
    )
    assert context[0]["value"] == (
        "Available A2UI catalog:\n- " + BASIC + "\n  Custom catalog (does NOT include all basic "
        "components).\n  Custom components:\n  - ProductCard"
    )


def test_a_custom_catalog_keeps_its_id_and_a_catalog_without_schemas_only_names_it():
    catalog_id, context = build_v09_catalog_context(
        {"forwardedProps": ui(components={"Title": TITLE})}
    ) or ("", [])
    assert catalog_id == "shop"
    assert list(schema_of(context)["components"]) == ["Title"]
    assert len(context) == 4
    assert build_v09_catalog_context({"forwardedProps": ui()}) == (
        "shop",
        [
            {
                "description": "A2UI catalog capabilities: available catalog IDs and custom "
                "component definitions the client can render.",
                "value": "Available A2UI catalog:\n- shop",
            }
        ],
    )
    assert build_v09_catalog_context({"forwardedProps": {}}) is None


def test_v09_agent_input_replaces_the_client_schema_entry():
    input = {
        "messages": [],
        "context": [{"description": SCHEMA_DESCRIPTION, "value": "{}"}, {"description": "x"}],
        "forwardedProps": ui(components={"ProductCard": CARD}),
    }
    agent_input = prepare_v09_agent_input(input, "0.9")
    descriptions = [entry["description"] for entry in agent_input["context"]]
    assert descriptions.count(SCHEMA_DESCRIPTION) == 1
    assert descriptions[0] == "x"
    assert schema_of(agent_input["context"])["catalogId"] == "shop"
    assert prepare_v09_agent_input(input, "1.0") is input


def test_args_schema_from_signature_maps_types_to_dynamic_refs():
    assert args_schema_from_signature("{ value: string; min?: number; [k: string]: unknown }") == {
        "type": "object",
        "properties": {
            "value": {"$ref": "common_types.json#/$defs/DynamicString"},
            "min": {"$ref": "common_types.json#/$defs/DynamicNumber"},
        },
        "required": ["value"],
        "additionalProperties": {"$ref": "common_types.json#/$defs/DynamicValue"},
    }
