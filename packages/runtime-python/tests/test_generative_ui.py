import copy
import json

import httpx
import pytest

from copilotkit_runtime import GenerativeUIConfig, IntelligenceRuntime, RuntimeConfig, User
from copilotkit_runtime.generative_ui import (
    GENERATIVE_UI_CONTEXT_DESCRIPTION,
    GenerativeUIMiddleware,
    build_generative_ui_prompt,
    generative_ui_info,
    is_generative_ui_run,
    read_tool_manifest,
    resolve_a2ui_version,
    validate_operation,
)

PRODUCT_CARD = {
    "description": "A product",
    "props": {
        "type": "object",
        "properties": {"name": {"type": "string"}, "price": {"type": "number"}},
        "required": ["name"],
    },
    "events": {"onBuy": {"description": "Buys it", "parameters": {}}},
    "slots": {"footer": "single", "children": "multiple"},
}
TEXT = {"props": {"type": "object", "properties": {"text": {"type": "string"}}}}


def envelope(transport="tool", components=None, surfaces=None, **extensions):
    catalog = {"catalogId": "shop", "protocolVersion": "1.0", "functions": {}}
    if components is not False:
        catalog["components"] = components or {"ProductCard": PRODUCT_CARD, "Text": TEXT}
    return {
        "copilotkit": {
            "ui": {
                "1.0": {"supportedCatalogIds": ["shop"], "inlineCatalogs": [catalog]},
                "metadata": {
                    "extensions": {
                        "copilotkit_format": 3,
                        "copilotkit_transport": transport,
                        "copilotkit_targets": [
                            {"id": "chat", "kind": "chat"},
                            {"id": "side", "kind": "inline", "components": ["Text"]},
                        ],
                        "copilotkit_surfaces": surfaces or {},
                        "copilotkit_contextSent": False,
                        **extensions,
                    }
                },
            }
        }
    }


def op(**operation):
    return {"version": "1.0", **operation}


def render_call(call_id, *chunks):
    return [
        {"type": "TOOL_CALL_START", "toolCallId": call_id, "toolCallName": "render_ui"},
        *({"type": "TOOL_CALL_ARGS", "toolCallId": call_id, "delta": chunk} for chunk in chunks),
        {"type": "TOOL_CALL_END", "toolCallId": call_id},
    ]


async def run(events, forwarded=None, messages=()):
    manifest = read_tool_manifest(forwarded or envelope())
    assert manifest is not None
    middleware = GenerativeUIMiddleware(manifest)

    async def source():
        for event in events:
            yield event

    return [event async for event in middleware.transform(source(), {"messages": list(messages)})]


def test_prepare_adds_one_render_tool_and_guide_without_mutating_input():
    manifest = read_tool_manifest(envelope())
    assert manifest is not None
    input = {
        "tools": [{"name": "render_ui", "description": "stale"}, {"name": "search"}],
        "context": [{"description": GENERATIVE_UI_CONTEXT_DESCRIPTION, "value": "stale"}],
    }
    original = copy.deepcopy(input)
    prepared = GenerativeUIMiddleware(manifest).prepare(input)
    assert input == original
    assert [tool["name"] for tool in prepared["tools"]] == ["search", "render_ui"]
    target = prepared["tools"][1]["parameters"]["properties"]["target"]
    assert target["enum"] == ["chat", "side"]
    [guide] = prepared["context"]
    assert guide["description"] == GENERATIVE_UI_CONTEXT_DESCRIPTION
    assert '- "side" (a named area of the app; only Text)' in guide["value"]
    assert '  props: {"type":"object","properties":{"name":{"type":"string"}' in guide["value"]
    assert (
        '  slot props (component ids): {"footer":"single","children":"multiple"}'
        in (guide["value"])
    )


def test_guide_includes_feature_rules_only_when_the_catalog_uses_them():
    with_events = build_generative_ui_prompt(read_tool_manifest(envelope()))
    plain = build_generative_ui_prompt(read_tool_manifest(envelope(components={"Text": TEXT})))
    assert "Event props take an action:" in with_events
    assert "give a multiple slot a template" in with_events
    assert "Event props take an action" not in plain
    assert "give a multiple slot a template" not in plain


def test_guide_lists_existing_surfaces_with_user_values_and_rejections():
    surfaces = {
        "cart": {"target": "chat", "dataModel": {"qty": 2}, "rejected": ["operation 1: bad"]},
        "old": {"target": "chat", "status": "deleted"},
    }
    guide = build_generative_ui_prompt(read_tool_manifest(envelope(surfaces=surfaces)))
    assert '- "cart" (target "chat")\n  user values: {"qty":2}\n  rejected: operation 1: bad' in (
        guide
    )
    assert '- "old" (target "chat", deleted: never use this id again)' in guide
    assert "User values are what the user entered" in guide


@pytest.mark.parametrize(
    "forwarded",
    [
        envelope(transport="markdown"),
        envelope(components=False),
        {"copilotkit": {"ui": {**envelope()["copilotkit"]["ui"], "1.0": {}}}},
        {},
    ],
    ids=["markdown", "no-components", "malformed", "missing"],
)
def test_runs_without_a_tool_catalog_pass_through(forwarded):
    assert read_tool_manifest(forwarded) is None


async def test_streamed_operations_create_then_patch_one_surface():
    create = op(
        createSurface={
            "surfaceId": "card",
            "catalogId": "unknown",
            "components": [{"id": "root", "component": "ProductCard", "name": "A", "footer": "t"}],
        }
    )
    update = op(
        updateComponents={"surfaceId": "card", "components": [{"id": "t", "component": "Text"}]}
    )
    invalid = op(
        updateComponents={"surfaceId": "card", "components": [{"id": "x", "component": "Nope"}]}
    )
    args = json.dumps({"target": "chat", "operations": [create, update, invalid]})
    events = await run(
        [*render_call("call", args[:60], args[60:]), {"type": "RUN_FINISHED"}],
    )
    [snapshot] = [event for event in events if event["type"] == "ACTIVITY_SNAPSHOT"]
    assert snapshot["messageId"] == "genui:card"
    # The model does not pick the catalog: an unlisted id gets the run's catalog.
    assert snapshot["content"]["catalogId"] == "shop"
    assert snapshot["content"]["operations"][0]["createSurface"]["catalogId"] == "shop"
    deltas = [event["patch"] for event in events if event["type"] == "ACTIVITY_DELTA"]
    assert deltas == [
        [{"op": "add", "path": "/operations/-", "value": update}],
        [
            {
                "op": "add",
                "path": "/rejected/-",
                "value": {"index": 2, "reason": 'component "x": unknown component "Nope"'},
            }
        ],
        [{"op": "replace", "path": "/status", "value": "ready"}],
    ]
    result, finished = events[-2:]
    assert finished["type"] == "RUN_FINISHED"
    assert result["type"] == "TOOL_CALL_RESULT"
    assert json.loads(result["content"]) == {
        "status": "rendered",
        "applied": 2,
        "calls": 0,
        "rejected": [{"index": 2, "reason": 'component "x": unknown component "Nope"'}],
    }


async def test_operations_wait_for_a_late_target_and_respect_its_components():
    args = json.dumps(
        {
            "operations": [
                op(createSurface={"surfaceId": "panel"}),
                op(
                    updateComponents={
                        "surfaceId": "panel",
                        "components": [{"id": "root", "component": "ProductCard", "name": "A"}],
                    }
                ),
            ],
            "target": "side",
        }
    )
    events = await run([*render_call("call", args), {"type": "RUN_FINISHED"}])
    [snapshot] = [event for event in events if event["type"] == "ACTIVITY_SNAPSHOT"]
    assert snapshot["content"]["target"] == "side"
    rejected = json.loads(events[-2]["content"])["rejected"]
    assert rejected == [
        {
            "index": 1,
            "reason": 'component "root": "ProductCard" is not allowed in target "side"; '
            "use one of: Text",
        }
    ]


async def test_operations_sent_as_a_string_are_recovered():
    operations = json.dumps([op(createSurface={"surfaceId": "late"})])
    events = await run(
        [*render_call("call", json.dumps({"target": "chat", "operations": operations}))]
        + [{"type": "RUN_FINISHED"}]
    )
    assert [event["messageId"] for event in events if event["type"] == "ACTIVITY_SNAPSHOT"] == [
        "genui:late"
    ]


async def test_answered_calls_get_no_result_and_empty_calls_report_an_error():
    events = await run(
        [
            *render_call("empty", '{"target":"chat"}'),
            *render_call("answered", '{"target":"chat","operations":[]}'),
            {"type": "TOOL_CALL_RESULT", "toolCallId": "answered", "content": "ok"},
            {"type": "RUN_FINISHED"},
        ]
    )
    results = [event for event in events if event["type"] == "TOOL_CALL_RESULT"]
    assert [result["toolCallId"] for result in results] == ["answered", "empty"]
    assert json.loads(results[1]["content"])["status"] == "error"
    assert events[-1]["type"] == "RUN_FINISHED"


async def test_existing_and_deleted_surfaces_follow_the_client_summary():
    surfaces = {"live": {"target": "chat"}, "gone": {"target": "chat", "status": "deleted"}}
    args = json.dumps(
        {
            "target": "chat",
            "operations": [
                op(updateDataModel={"surfaceId": "live", "path": "/x", "value": 1}),
                op(createSurface={"surfaceId": "gone"}),
                op(createSurface={"surfaceId": "live"}),
            ],
        }
    )
    events = await run(
        [*render_call("call", args), {"type": "RUN_FINISHED"}],
        envelope(surfaces=surfaces),
    )
    reasons = [entry["reason"] for entry in json.loads(events[-2]["content"])["rejected"]]
    assert reasons == [
        'surface id "gone" was used before; use a new surfaceId',
        'surface "live" already exists',
    ]
    first_patch = next(event for event in events if event["type"] == "ACTIVITY_DELTA")["patch"]
    # The first touch of an existing surface marks it streaming and clears old rejections.
    assert first_patch[:2] == [
        {"op": "replace", "path": "/status", "value": "streaming"},
        {"op": "replace", "path": "/rejected", "value": []},
    ]


@pytest.mark.parametrize(
    ("component", "reason"),
    [
        (
            {"id": "a", "component": "Text", "text": {"path": "/x"}},
            'component "a": text: bind data with {"@path": "/x"}, not {"path": "/x"}',
        ),
        ({"id": "a", "component": "Text", "size": 1}, 'component "a": unknown prop "size"'),
        (
            {"id": "a", "component": "ProductCard"},
            'component "a": missing required prop "name"',
        ),
        (
            {"id": "a", "component": "ProductCard", "name": "x", "footer": "a"},
            'component "a": footer: a component cannot be its own child',
        ),
        (
            {"id": "a", "component": "ProductCard", "name": "x", "onBuy": {"event": "buy"}},
            'component "a": onBuy: event.name is required',
        ),
        (
            {"id": "a", "component": "Text", "text": {"@call": "openUrl"}},
            'component "a": text: "openUrl" runs only from an event; a data prop can call only '
            "@index and the built-in functions (required, regex, length, numeric, email, "
            "formatString, formatNumber, formatCurrency, formatDate, pluralize, and, or, not, "
            "calc, series)",
        ),
        (
            {
                "id": "a",
                "component": "ProductCard",
                "name": "x",
                "children": {"componentId": "b", "path": "/__proto__"},
            },
            'component "a": children: path segment "__proto__" is not allowed in template path',
        ),
    ],
)
def test_validation_rejects_components_with_the_typescript_reasons(component, reason):
    manifest = read_tool_manifest(envelope())
    assert manifest is not None
    operation = op(updateComponents={"surfaceId": "s", "components": [component]})
    assert validate_operation(operation, manifest, {"s"}, functions={}) == reason


def test_validation_requires_an_existing_surface_and_a_value():
    manifest = read_tool_manifest(envelope())
    assert manifest is not None
    assert validate_operation(op(deleteSurface={"surfaceId": "s"}), manifest, set()) == (
        'surface "s" does not exist; send createSurface first'
    )
    assert validate_operation(op(updateDataModel={"surfaceId": "s"}), manifest, {"s"}) == (
        'updateDataModel.value is required; use "value":null to delete'
    )
    assert validate_operation({"deleteSurface": {"surfaceId": "s"}}, manifest, {"s"}) == (
        'operation needs "version":"1.0"'
    )


@pytest.mark.parametrize(
    ("option", "forwarded", "agent", "expected"),
    [
        (None, envelope(), "default", True),
        (None, {}, "default", False),
        (True, {}, "default", True),
        (True, envelope(transport="markdown"), "default", False),
        (False, envelope(), "default", False),
        (GenerativeUIConfig(), {}, "default", True),
        (GenerativeUIConfig(agents=("other",)), envelope(), "default", False),
    ],
)
def test_generative_ui_runs_follow_option_transport_and_agent_scope(
    option, forwarded, agent, expected
):
    assert is_generative_ui_run(option, agent, forwarded) is expected


def test_a2ui_version_and_info_resolve_per_agent():
    option = GenerativeUIConfig(a2ui_version={"legacy": "0.9"}, agents=("legacy", "current"))
    assert resolve_a2ui_version(option, "legacy") == "0.9"
    assert resolve_a2ui_version(option, "current") == "1.0"
    assert resolve_a2ui_version(True, "legacy") == "1.0"
    assert generative_ui_info(option) == {"enabled": True, "agents": ["legacy", "current"]}
    assert generative_ui_info(None) == {"enabled": True}
    assert generative_ui_info(False) == {"enabled": False}
    with pytest.raises(ValueError, match="a2ui_version"):
        GenerativeUIConfig(a2ui_version="2.0")
    with pytest.raises(ValueError, match="inject_tool"):
        GenerativeUIConfig(inject_a2ui_tool="")


class RecordingAgent:
    description = "Recording agent"

    def __init__(self, events):
        self.events = events
        self.inputs = []

    async def run(self, input):
        self.inputs.append(input)
        for event in self.events:
            yield event


async def identify(request):
    return User(id="user")


def runtime(agent, generative_ui):
    return IntelligenceRuntime(
        RuntimeConfig(
            api_key="secret",
            api_url="http://platform",
            runner_url="ws://runner",
            client_url="ws://client",
            telemetry_enabled=False,
        ),
        agents={"default": agent},
        identify_user=identify,
        http_client=httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(503))
        ),
        generative_ui=generative_ui,
    )


async def test_info_reports_generative_ui_instead_of_a2ui():
    app = runtime(RecordingAgent([]), GenerativeUIConfig(agents=("default",)))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://runtime"
    ) as client:
        body = (await client.get("/copilotkit/info")).json()
    assert body["generativeUI"] == {"enabled": True, "agents": ["default"]}
    assert "a2uiEnabled" not in body and "a2ui" not in body
    await app.aclose()


async def test_each_agent_version_gets_its_own_render_tool():
    input = {"messages": [], "tools": [], "context": [], "forwardedProps": envelope()}
    current = RecordingAgent([{"type": "RUN_FINISHED"}])
    app = runtime(current, None)
    [event async for event in app._agent_events("default", input)]
    assert [tool["name"] for tool in current.inputs[0]["tools"]] == ["render_ui"]
    await app.aclose()

    legacy = RecordingAgent([{"type": "RUN_FINISHED"}])
    app = runtime(legacy, GenerativeUIConfig(a2ui_version="0.9"))
    [event async for event in app._agent_events("default", input)]
    agent_input = legacy.inputs[0]
    assert [tool["name"] for tool in agent_input["tools"]] == ["render_a2ui"]
    assert all(
        entry["description"] != GENERATIVE_UI_CONTEXT_DESCRIPTION
        for entry in agent_input["context"]
    )
    schema = next(
        entry for entry in agent_input["context"] if entry["description"].startswith("A2UI Comp")
    )
    assert list(json.loads(schema["value"])["components"]) == ["ProductCard", "Text"]
    await app.aclose()


async def test_v09_render_call_reaches_the_browser_as_a_v10_surface():
    agent = RecordingAgent(
        [
            {"type": "TOOL_CALL_START", "toolCallId": "call", "toolCallName": "render_a2ui"},
            {
                "type": "TOOL_CALL_ARGS",
                "toolCallId": "call",
                "delta": json.dumps(
                    {
                        "surfaceId": "card",
                        "components": [{"id": "root", "component": "Text", "text": "Hi"}],
                    }
                ),
            },
            {"type": "RUN_FINISHED"},
        ]
    )
    app = runtime(agent, GenerativeUIConfig(a2ui_version="0.9"))
    input = {"messages": [], "forwardedProps": envelope()}
    events = [event async for event in app._agent_events("default", input)]
    assert not any(event.get("activityType") == "a2ui-surface" for event in events)
    [snapshot] = [event for event in events if event["type"] == "ACTIVITY_SNAPSHOT"]
    assert snapshot["messageId"] == "genui:card"
    assert snapshot["content"]["a2uiSourceVersion"] == "0.9"
    assert snapshot["content"]["catalogId"] == "shop"
    assert [event["type"] for event in events[-2:]] == ["TOOL_CALL_RESULT", "RUN_FINISHED"]
    await app.aclose()
