import json

import pytest

from copilotkit_runtime.a2ui import (
    SCHEMA_DESCRIPTION,
    A2UIConfig,
    A2UIMiddleware,
    validate_components,
)


def test_component_validation_rejects_cycles_and_catalog_missing_properties():
    components = [{"id": "root", "component": "Column", "children": ["root"]}]
    errors = validate_components(components, {"components": {"Column": {"required": ["gap"]}}})
    assert {error["code"] for error in errors} == {"child_cycle", "missing_required_prop"}


async def test_streamed_components_atomic_and_data_progressive():
    middleware = A2UIMiddleware(A2UIConfig(inject_tool=True))
    request = {"messages": [], "tools": [], "context": []}
    prepared = middleware.prepare(request)
    assert prepared["tools"][0]["name"] == "render_a2ui"
    components = [
        {
            "id": "root",
            "component": "Column",
            "children": {"componentId": "item", "path": "/items"},
        },
        {"id": "item", "component": "Text", "text": {"path": "title"}},
    ]
    prefix = '{"surfaceId":"cards","components":' + json.dumps(components)

    async def source():
        yield {"type": "TOOL_CALL_START", "toolCallId": "call", "toolCallName": "render_a2ui"}
        yield {"type": "TOOL_CALL_ARGS", "toolCallId": "call", "delta": prefix[:-1]}
        yield {
            "type": "TOOL_CALL_ARGS",
            "toolCallId": "call",
            "delta": '],"data":{"items":[{"title":"first"},',
        }
        yield {"type": "TOOL_CALL_ARGS", "toolCallId": "call", "delta": '{"title":"second"}]}}'}
        yield {"type": "RUN_FINISHED"}

    events = [event async for event in middleware.transform(source(), request)]
    first_args = next(i for i, event in enumerate(events) if event["type"] == "TOOL_CALL_ARGS")
    assert not any("a2ui_operations" in event.get("content", {}) for event in events[:first_args])
    activities = [event for event in events if event["type"] == "ACTIVITY_SNAPSHOT"]
    assert all(event["messageId"] == "a2ui-surface-call" for event in activities)
    paints = [event for event in activities if "a2ui_operations" in event["content"]]
    assert (
        paints[0]["content"]["a2ui_operations"][1]["updateComponents"]["components"] == components
    )
    assert (
        len(paints[0]["content"]["a2ui_operations"][-1]["updateDataModel"]["value"]["items"]) == 1
    )
    assert (
        len(paints[-1]["content"]["a2ui_operations"][-1]["updateDataModel"]["value"]["items"]) == 2
    )
    assert events[-2]["type"] == "TOOL_CALL_RESULT"
    assert events[-1]["type"] == "RUN_FINISHED"


def test_action_history_and_frontend_catalog_preserved():
    middleware = A2UIMiddleware(
        A2UIConfig(schema={"catalogId": "server", "components": {"Text": {}}})
    )
    request = {
        "messages": [],
        "tools": [],
        "context": [
            {
                "description": SCHEMA_DESCRIPTION,
                "value": json.dumps({"catalogId": "frontend", "components": {}}),
            }
        ],
        "forwardedProps": {"a2uiAction": {"userAction": {"name": "accept", "surfaceId": "card"}}},
    }
    prepared = middleware.prepare(request)
    assert prepared["messages"][-2]["toolCalls"][0]["function"]["name"] == "log_a2ui_event"
    assert prepared["messages"][-1]["role"] == "tool"
    assert len(request["messages"]) == 0


def test_invalid_tool_configuration_fails_at_construction():
    with pytest.raises(ValueError, match="inject_tool"):
        A2UIConfig(inject_tool={"name": "not-supported"})


async def test_outer_retry_and_final_envelope_share_one_activity():
    middleware = A2UIMiddleware(A2UIConfig())

    async def source():
        yield {"type": "TOOL_CALL_START", "toolCallId": "outer", "toolCallName": "generate_ui"}
        yield {"type": "TOOL_CALL_START", "toolCallId": "bad", "toolCallName": "render_a2ui"}
        yield {
            "type": "TOOL_CALL_ARGS",
            "toolCallId": "bad",
            "delta": json.dumps(
                {
                    "surfaceId": "card",
                    "components": [{"id": "root", "component": "Column", "child": "missing"}],
                }
            ),
        }
        yield {"type": "TOOL_CALL_START", "toolCallId": "good", "toolCallName": "render_a2ui"}
        yield {
            "type": "TOOL_CALL_ARGS",
            "toolCallId": "good",
            "delta": json.dumps(
                {
                    "surfaceId": "card",
                    "components": [{"id": "root", "component": "Text", "text": "Valid"}],
                }
            ),
        }
        yield {
            "type": "TOOL_CALL_RESULT",
            "toolCallId": "outer",
            "content": json.dumps(
                {
                    "a2ui_operations": [
                        {
                            "version": "v0.9",
                            "createSurface": {
                                "surfaceId": "card",
                                "catalogId": "ignored-duplicate",
                            },
                        }
                    ]
                }
            ),
        }
        yield {"type": "RUN_FINISHED"}

    events = [event async for event in middleware.transform(source(), {})]
    activities = [event for event in events if event["type"] == "ACTIVITY_SNAPSHOT"]
    assert {event["messageId"] for event in activities} == {"a2ui-surface-outer"}
    assert any(event["content"].get("status") == "retrying" for event in activities)
    assert len([event for event in activities if "a2ui_operations" in event["content"]]) == 1


def test_catalog_reference_fields_detect_missing_refs_in_nested_arrays():
    catalog = {
        "components": {
            "Tabs": {
                "properties": {
                    "tabItems": {
                        "type": "array",
                        "items": {"properties": {"child": {"format": "componentRef"}}},
                    }
                }
            }
        }
    }
    errors = validate_components(
        [{"id": "root", "component": "Tabs", "tabItems": [{"child": "missing"}]}], catalog
    )
    assert errors[0]["code"] == "unresolved_child"
    assert errors[0]["path"] == "components[0].tabItems[0].child"


@pytest.mark.asyncio
async def test_terminal_does_not_reorder_later_agent_events():
    middleware = A2UIMiddleware(A2UIConfig(inject_tool=True))

    async def source():
        yield {"type": "RUN_FINISHED"}
        yield {"type": "CUSTOM", "name": "after-terminal"}
        yield {"type": "RUN_FINISHED"}

    events = [event async for event in middleware.transform(source(), {"messages": []})]
    assert [event["type"] for event in events] == ["RUN_FINISHED", "CUSTOM", "RUN_FINISHED"]
